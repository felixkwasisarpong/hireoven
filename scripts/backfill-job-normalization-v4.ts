/**
 * Re-runs deterministic job normalization on every job whose cached
 * raw_data.normalized.schema_version is missing or older than the current
 * JOB_NORMALIZATION_VERSION. Writes the new canonical and view back into
 * raw_data so the stored payload matches what the read path now returns.
 *
 * Scalar columns (salary_min, sponsors_h1b, …) are intentionally not
 * touched here — this backfill only updates raw_data.normalized and
 * raw_data.view so existing AI-enriched scalars stay intact.
 *
 * Usage:
 *   npx tsx scripts/backfill-job-normalization-v4.ts                # dry-run
 *   npx tsx scripts/backfill-job-normalization-v4.ts --execute
 *   npx tsx scripts/backfill-job-normalization-v4.ts --execute --batch=200 --limit=2000
 */

import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())

import pLimit from "p-limit"
import {
  normalizePersistedJobRecord,
  type PersistedJobForNormalization,
} from "@/lib/jobs/normalization"
import { JOB_NORMALIZATION_VERSION } from "@/lib/jobs/normalization/types"
import { getPostgresPool } from "@/lib/postgres/server"

const args = process.argv.slice(2)
function flag(name: string): string | undefined {
  const prefix = `--${name}=`
  const direct = args.find((v) => v.startsWith(prefix))
  if (direct) return direct.slice(prefix.length)
  const idx = args.indexOf(`--${name}`)
  if (idx !== -1) return args[idx + 1]
  return undefined
}
function intFlag(name: string, fallback: number, min = 1): number {
  const raw = Number.parseInt(flag(name) ?? "", 10)
  return Number.isFinite(raw) && raw >= min ? raw : fallback
}

const execute = args.includes("--execute")
const batchSize = intFlag("batch", 200)
const totalLimit = intFlag("limit", 1_000_000)
const concurrency = intFlag("concurrency", 8)
const jobIdFlag = flag("job-id")?.trim() || null

async function main() {
  const pool = getPostgresPool()
  const limiter = pLimit(concurrency)
  console.log(
    [
      "── backfill-job-normalization ───────────────────────────",
      `  mode:        ${execute ? "EXECUTE" : "DRY RUN"}`,
      `  target ver:  ${JOB_NORMALIZATION_VERSION}`,
      `  batch:       ${batchSize}`,
      `  limit:       ${totalLimit}`,
      `  concurrency: ${concurrency}`,
      jobIdFlag ? `  job-id:      ${jobIdFlag}` : undefined,
      "─────────────────────────────────────────────────────────",
    ]
      .filter(Boolean)
      .join("\n")
  )

  try {
    // Single-job mode for quick smoke tests.
    if (jobIdFlag) {
      const result = await processBatch(pool, limiter, [jobIdFlag], execute)
      console.log(`\nSingle-job result: ${JSON.stringify(result)}`)
      return
    }

    let processed = 0
    let updated = 0
    let skipped = 0
    let lastId: string | null = null

    while (processed < totalLimit) {
      // Pull a batch of job ids whose normalized cache is stale.
      const remaining = Math.min(batchSize, totalLimit - processed)
      const idsResult = await pool.query<{ id: string }>(
        `SELECT id::text AS id FROM jobs
          WHERE (raw_data IS NULL
                 OR raw_data->'normalized'->>'schema_version' IS DISTINCT FROM $1)
            ${lastId ? "AND id > $3::uuid" : ""}
          ORDER BY id
          LIMIT $2`,
        lastId ? [JOB_NORMALIZATION_VERSION, remaining, lastId] : [JOB_NORMALIZATION_VERSION, remaining]
      )
      const ids = idsResult.rows.map((r) => r.id)
      if (ids.length === 0) break

      const batchResult = await processBatch(pool, limiter, ids, execute)
      processed += ids.length
      updated += batchResult.updated
      skipped += batchResult.skipped
      lastId = ids[ids.length - 1]
      console.log(`  processed=${processed}  updated=${updated}  skipped=${skipped}`)

      if (ids.length < remaining) break
    }

    console.log(
      `\nDone. processed=${processed}  updated=${updated}  skipped=${skipped}  mode=${execute ? "execute" : "dry-run"}`
    )
  } finally {
    await pool.end()
  }
}

async function processBatch(
  pool: ReturnType<typeof getPostgresPool>,
  limiter: ReturnType<typeof pLimit>,
  ids: string[],
  execute: boolean
): Promise<{ updated: number; skipped: number }> {
  const placeholders = ids.map((_, i) => `$${i + 1}::uuid`).join(",")
  const jobsResult = await pool.query(
    `SELECT * FROM jobs WHERE id IN (${placeholders})`,
    ids
  )
  let updated = 0
  let skipped = 0

  await Promise.all(
    jobsResult.rows.map((job: Record<string, unknown>) =>
      limiter(async () => {
        try {
          const result = normalizePersistedJobRecord(job as unknown as PersistedJobForNormalization)
          const existing =
            job.raw_data && typeof job.raw_data === "object"
              ? (job.raw_data as Record<string, unknown>)
              : {}
          const nextRawData: Record<string, unknown> = {
            ...existing,
            normalized: result.canonical,
            view: {
              ...((existing.view && typeof existing.view === "object" ? existing.view : {}) as Record<string, unknown>),
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
              method: "deterministic_backfill",
            },
          }

          if (!execute) {
            skipped += 1
            return
          }

          await pool.query(
            `UPDATE jobs SET raw_data = $1::jsonb, updated_at = now() WHERE id = $2::uuid`,
            [JSON.stringify(nextRawData), job.id]
          )
          updated += 1
        } catch (error) {
          console.error(`  [error] job=${job.id} ${error instanceof Error ? error.message : String(error)}`)
          skipped += 1
        }
      })
    )
  )

  return { updated, skipped }
}

main().catch((error) => {
  console.error("[backfill-job-normalization-v4] fatal:", error)
  process.exit(1)
})
