/**
 * Backfill deterministic normalization (skills, seniority, normalized_title, …)
 * onto aggregator-sourced jobs that were ingested before the ingest route ran
 * the normalizer. Adzuna/jsearch/waas previously landed with a description but
 * 0% skills; this walks the existing rows and fills the structured columns.
 *
 * Deterministic only — no AI, no spend. Safe to re-run (idempotent).
 *
 * Usage:
 *   npx tsx scripts/backfill-aggregator-normalization.ts                 # adzuna, all
 *   npx tsx scripts/backfill-aggregator-normalization.ts --source=adzuna --batch=500 --loops=200
 *   npx tsx scripts/backfill-aggregator-normalization.ts --source=jsearch
 *   npx tsx scripts/backfill-aggregator-normalization.ts --dry-run
 */

import { loadEnvConfig } from "@next/env"
import { getPostgresPool } from "@/lib/postgres/server"
import { normalizePersistedJobRecord, type PersistedJobForNormalization } from "@/lib/jobs/normalization"
import { publicationStatusForJob } from "@/lib/jobs/publication"

loadEnvConfig(process.cwd())

function arg(name: string, fallback: string): string {
  const found = process.argv.find((a) => a.startsWith(`--${name}=`))
  return found ? (found.split("=")[1] ?? fallback) : fallback
}

const source = arg("source", "adzuna")
const batchSize = Math.max(1, Number.parseInt(arg("batch", "500"), 10))
const loops = Math.max(1, Number.parseInt(arg("loops", "100000"), 10))
const pauseMs = Math.max(0, Number.parseInt(arg("pause", "150"), 10))
const dryRun = process.argv.includes("--dry-run")

type Row = PersistedJobForNormalization & { id: string }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const pool = getPostgresPool()
  const prefix = `${source}:` // external_id is `<source>:<id>` — indexed (idx_jobs_external_id)

  async function freshClient() {
    const c = await pool.connect()
    await c.query("SET statement_timeout = '120s'")
    return c
  }
  let client = await freshClient()

  let totalUpdated = 0
  // Keyset by the INDEXED external_id (prefix range) — not by id, which forced a
  // full heap scan for the un-indexed source predicate and got the connection
  // killed. Resume position survives reconnects.
  let lastExtId = prefix

  for (let i = 0; i < loops; i += 1) {
    let rows: Row[]
    try {
      const res = await client.query<Row>(
        `SELECT id, title, normalized_title, location, apply_url, external_id, description,
                employment_type, seniority_level, is_remote, is_hybrid, salary_min, salary_max,
                salary_currency, sponsors_h1b, sponsorship_score, requires_authorization,
                visa_language_detected, skills, first_detected_at, raw_data
           FROM jobs
          WHERE external_id > $1
            AND external_id LIKE $2
            AND is_active = true
            AND (skills IS NULL OR array_length(skills, 1) IS NULL)
            AND length(description) >= 80
          ORDER BY external_id
          LIMIT $3`,
        [lastExtId, `${prefix}%`, batchSize]
      )
      rows = res.rows
    } catch (err) {
      // Box reaper killed the backend, or a transient timeout. Reconnect and retry
      // the same keyset position.
      console.warn(`[backfill ${source}] read failed, reconnecting: ${(err as Error).message}`)
      try { client.release() } catch {}
      await sleep(2000)
      client = await freshClient()
      continue
    }

    if (rows.length === 0) break
    const nextLastExtId = rows[rows.length - 1].external_id ?? lastExtId

    try {
      for (const job of rows) {
        const norm = normalizePersistedJobRecord(job)
        const nc = norm.nextColumns
        const status = publicationStatusForJob({ description: nc.description, skills: nc.skills })

        if (dryRun) { totalUpdated += 1; continue }

        const rawData = JSON.stringify({
          ...(typeof job.raw_data === "object" && job.raw_data ? job.raw_data : {}),
          description_captured: Boolean(nc.description),
          normalization: {
            version: norm.canonical.schema_version,
            normalized_at: norm.canonical.normalized_at,
            confidence_score: norm.canonical.validation.confidence_score,
            completeness_score: norm.canonical.validation.completeness_score,
            requires_review: norm.canonical.validation.requires_review,
            issues: norm.canonical.validation.issues,
          },
          normalized: norm.canonical,
          structured_job: norm.structuredData,
          view: { page: norm.pageView, card: norm.cardView },
        })

        await client.query(
          `UPDATE jobs SET
             normalized_title=$2, location=$3, is_remote=$4, is_hybrid=$5,
             employment_type=$6, seniority_level=$7, description=$8,
             salary_min=$9, salary_max=$10, salary_currency=$11,
             requires_authorization=$12, sponsors_h1b=$13, sponsorship_score=$14,
             visa_language_detected=$15, skills=$16, publication_status=$17,
             raw_data=$18, updated_at=NOW()
           WHERE id=$1`,
          [job.id, nc.normalized_title, nc.location, nc.is_remote, nc.is_hybrid,
           nc.employment_type, nc.seniority_level, nc.description,
           nc.salary_min, nc.salary_max, nc.salary_currency ?? "USD",
           nc.requires_authorization, nc.sponsors_h1b, nc.sponsorship_score,
           nc.visa_language_detected, nc.skills, status, rawData]
        )
        totalUpdated += 1
      }
    } catch (err) {
      // Reconnect and replay this batch — already-updated rows now have skills and
      // drop out of the filter, so it's idempotent.
      console.warn(`[backfill ${source}] write failed, reconnecting: ${(err as Error).message}`)
      try { client.release() } catch {}
      await sleep(2000)
      client = await freshClient()
      continue // lastExtId unchanged → re-fetch the remainder of this batch
    }

    lastExtId = nextLastExtId
    console.log(`[backfill ${source}] batch=${rows.length} total=${totalUpdated} at=${lastExtId}${dryRun ? " (dry-run)" : ""}`)
    if (rows.length < batchSize) break
    if (pauseMs > 0) await sleep(pauseMs) // breathe — the web box also serves the app
  }

  try { client.release() } catch {}
  await pool.end().catch(() => {})
  console.log(`\n[backfill ${source}] done — ${totalUpdated} rows ${dryRun ? "would be" : ""} updated`)
}

main().catch((error) => {
  console.error("backfill-aggregator-normalization failed:", error)
  process.exit(1)
})
