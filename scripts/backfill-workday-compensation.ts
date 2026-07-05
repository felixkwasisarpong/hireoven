/**
 * Scoped re-normalization for the Workday compensation fix (salary parsed from
 * structured pay text + qualification bullets rerouted out of the compensation
 * section). Targets the recently-active US/CA feed slice only, using the
 * idx_jobs_us_ca_active_freshest partial index — no full-table scan, no OOM risk.
 *
 * Unlike the generic v4 backfill this ALSO fills the scalar salary_min/max
 * columns (COALESCE — only when currently null, so AI-enriched values are safe),
 * so feed filters and evidence facts pick up the parsed range.
 *
 * Batched with a pause + periodic db-size print so a disk-constrained box stays
 * healthy. Dry-run by default.
 *
 *   npx tsx scripts/backfill-workday-compensation.ts               # dry-run, prints scope
 *   npx tsx scripts/backfill-workday-compensation.ts --execute --days=14
 *   npx tsx scripts/backfill-workday-compensation.ts --execute --days=30 --cap=200000
 */
import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())

import pLimit from "p-limit"
import {
  normalizePersistedJobRecord,
  type PersistedJobForNormalization,
} from "@/lib/jobs/normalization"
import { getPostgresPool } from "@/lib/postgres/server"

const args = process.argv.slice(2)
function flag(name: string): string | undefined {
  const p = `--${name}=`
  const d = args.find((v) => v.startsWith(p))
  if (d) return d.slice(p.length)
  const i = args.indexOf(`--${name}`)
  return i !== -1 ? args[i + 1] : undefined
}
function intFlag(name: string, fallback: number): number {
  const n = Number.parseInt(flag(name) ?? "", 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

const execute = args.includes("--execute")
const days = intFlag("days", 14)
const cap = intFlag("cap", 1_000_000)
const batchSize = intFlag("batch", 200)
const concurrency = intFlag("concurrency", 6)
const pauseMs = intFlag("pause-ms", 250)

async function dbSize(pool: ReturnType<typeof getPostgresPool>): Promise<string> {
  const r = await pool.query(`SELECT pg_size_pretty(pg_database_size(current_database())) AS s`)
  return r.rows[0].s
}

async function main() {
  const pool = getPostgresPool()
  const limiter = pLimit(concurrency)

  console.log(
    [
      "── backfill-workday-compensation ─────────────────────────",
      `  mode:        ${execute ? "EXECUTE" : "DRY RUN"}`,
      `  window:      last ${days} days (US/CA active Workday, null salary)`,
      `  cap:         ${cap}`,
      `  batch:       ${batchSize}   concurrency: ${concurrency}   pause: ${pauseMs}ms`,
      "──────────────────────────────────────────────────────────",
    ].join("\n")
  )

  // One indexed pass to collect candidate ids (freshest first). ids only → cheap.
  const { rows: idRows } = await pool.query<{ id: string }>(
    `SELECT id::text AS id
       FROM jobs
      WHERE is_active = true
        AND is_us_or_ca_strict = true
        AND source_ats = 'workday'
        AND salary_min IS NULL
        AND (raw_data->'normalization'->>'method') IS DISTINCT FROM 'workday_comp_backfill'
        AND first_detected_at > now() - ($1 || ' days')::interval
      ORDER BY first_detected_at DESC
      LIMIT $2`,
    [String(days), cap]
  )
  const allIds = idRows.map((r) => r.id)
  console.log(`  candidates:  ${allIds.length}`)
  console.log(`  db size:     ${await dbSize(pool)} (start)\n`)

  if (!execute) {
    console.log("DRY RUN — no writes. Re-run with --execute to apply.")
    await pool.end()
    return
  }
  if (allIds.length === 0) {
    await pool.end()
    return
  }

  let processed = 0
  let updated = 0
  let salaryFilled = 0
  let failed = 0

  for (let i = 0; i < allIds.length; i += batchSize) {
    const ids = allIds.slice(i, i + batchSize)
    const placeholders = ids.map((_, j) => `$${j + 1}::uuid`).join(",")
    const { rows: jobs } = await pool.query(
      `SELECT * FROM jobs WHERE id IN (${placeholders})`,
      ids
    )

    await Promise.all(
      jobs.map((job: Record<string, unknown>) =>
        limiter(async () => {
          try {
            const result = normalizePersistedJobRecord(
              job as unknown as PersistedJobForNormalization
            )
            const existing =
              job.raw_data && typeof job.raw_data === "object"
                ? (job.raw_data as Record<string, unknown>)
                : {}
            const nextRawData: Record<string, unknown> = {
              ...existing,
              normalized: result.canonical,
              view: {
                ...((existing.view && typeof existing.view === "object"
                  ? existing.view
                  : {}) as Record<string, unknown>),
                page: result.pageView,
                card: result.cardView,
              },
              normalization: {
                version: result.canonical.schema_version,
                normalized_at: result.canonical.normalized_at,
                confidence_score: result.canonical.validation.confidence_score,
                completeness_score: result.canonical.validation.completeness_score,
                requires_review: result.canonical.validation.requires_review,
                issues: result.canonical.validation.issues,
                method: "workday_comp_backfill",
              },
            }

            // Fill scalar salary columns from the freshly parsed range, but only
            // when currently null — never clobber an existing (AI-enriched) value.
            const min = result.nextColumns.salary_min
            const max = result.nextColumns.salary_max
            const cur = result.nextColumns.salary_currency ?? "USD"
            const res = await pool.query(
              `UPDATE jobs SET
                 raw_data = $1::jsonb,
                 salary_min = COALESCE(salary_min, $3),
                 salary_max = COALESCE(salary_max, $4),
                 salary_currency = COALESCE(salary_currency, $5),
                 updated_at = now()
               WHERE id = $2::uuid
               RETURNING (salary_min IS NOT NULL) AS has_salary`,
              [JSON.stringify(nextRawData), job.id, min, max, cur]
            )
            updated += 1
            if (res.rows[0]?.has_salary && min != null) salaryFilled += 1
          } catch (e) {
            failed += 1
            console.error(`  [err] ${job.id}: ${e instanceof Error ? e.message : String(e)}`)
          }
        })
      )
    )

    processed += ids.length
    if (processed % (batchSize * 10) === 0 || i + batchSize >= allIds.length) {
      console.log(
        `  processed=${processed}/${allIds.length}  updated=${updated}  salary_filled=${salaryFilled}  failed=${failed}  db=${await dbSize(pool)}`
      )
    }
    await new Promise((r) => setTimeout(r, pauseMs))
  }

  console.log(
    `\nDone. processed=${processed}  updated=${updated}  salary_filled=${salaryFilled}  failed=${failed}  db=${await dbSize(pool)}`
  )
  await pool.end()
}

main().catch((e) => {
  console.error("[backfill-workday-compensation] fatal:", e)
  process.exit(1)
})
