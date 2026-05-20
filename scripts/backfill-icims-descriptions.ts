/**
 * One-shot backfill: fetch real job descriptions for existing iCIMS jobs whose
 * `description` column is empty or short. iCIMS' search listing has no
 * description — only the per-job detail page (`/jobs/<id>/<slug>/job?in_iframe=1`)
 * carries the JSON-LD JobPosting block. The harvester caps detail fetches per
 * cycle so large customers accumulate description-less rows.
 *
 *   npx tsx scripts/backfill-icims-descriptions.ts                       # dry-run
 *   npx tsx scripts/backfill-icims-descriptions.ts --execute
 *   npx tsx scripts/backfill-icims-descriptions.ts --execute --limit=5000
 *   npx tsx scripts/backfill-icims-descriptions.ts --execute --min-length=300
 *
 * Idempotent — re-runs only touch jobs still under the min-length threshold.
 */

import { loadEnvConfig } from "@next/env"
import pLimit from "p-limit"
import { hashContent } from "@/lib/harvester/adapters/_base"
import { fetchJobDetail as fetchIcimsJobDetail } from "@/lib/harvester/adapters/icims"
import { getPostgresPool } from "@/lib/postgres/server"

loadEnvConfig(process.cwd())

const args = process.argv.slice(2)
const dryRun = !args.includes("--execute")

function getArg(prefix: string): string | undefined {
  return args.find((a) => a.startsWith(prefix))?.split("=")[1]
}

const limit = Math.max(1, Number.parseInt(getArg("--limit=") ?? "1000", 10))
const concurrency = Math.max(1, Number.parseInt(getArg("--concurrency=") ?? "4", 10))
const minLength = Math.max(0, Number.parseInt(getArg("--min-length=") ?? "300", 10))

type CandidateRow = {
  job_id: string
  job_title: string
  job_apply_url: string
  job_location: string | null
  job_posted_at: string | null
  job_description: string | null
  job_external_id: string
}

// External IDs look like `icims:<host>:<jobId>`. Parse out the parts so we can
// rebuild the JobLink the adapter's fetchJobDetail expects.
function parseExternalId(externalId: string): { host: string; jobId: string } | null {
  const m = externalId.match(/^icims:([^:]+):(\d+)$/)
  return m ? { host: m[1], jobId: m[2] } : null
}

async function loadCandidates(): Promise<CandidateRow[]> {
  const pool = getPostgresPool()
  const { rows } = await pool.query<CandidateRow>(
    `SELECT j.id          AS job_id,
            j.title       AS job_title,
            j.apply_url   AS job_apply_url,
            j.location    AS job_location,
            j.posted_at   AS job_posted_at,
            j.description AS job_description,
            j.external_id AS job_external_id
       FROM jobs j
      WHERE j.source_ats = 'icims'
        AND j.is_active = true
        AND j.closed_at IS NULL
        AND (j.description IS NULL OR length(j.description) < $2)
      ORDER BY j.first_detected_at DESC NULLS LAST
      LIMIT $1`,
    [limit, minLength]
  )
  return rows
}

async function main() {
  console.log(
    `[backfill-icims-descriptions] mode=${dryRun ? "dry-run" : "execute"} limit=${limit} concurrency=${concurrency} min-length=${minLength}`
  )

  const candidates = await loadCandidates()
  console.log(`[backfill-icims-descriptions] loaded ${candidates.length} candidates`)

  let enriched = 0
  let skipped = 0
  let fetchFailed = 0
  let unchanged = 0
  let updated = 0

  const limiter = pLimit(concurrency)
  const pool = getPostgresPool()

  await Promise.all(
    candidates.map((row) =>
      limiter(async () => {
        const parts = parseExternalId(row.job_external_id)
        if (!parts) {
          skipped += 1
          return
        }
        const detail = await fetchIcimsJobDetail(
          { host: parts.host, jobId: parts.jobId, title: row.job_title, url: row.job_apply_url },
          { etag: null, lastModified: null }
        )
        if (!detail) {
          fetchFailed += 1
          return
        }
        const newDescription = detail.description?.trim()
        if (!newDescription || newDescription.length <= (row.job_description?.length ?? 0)) {
          unchanged += 1
          return
        }
        enriched += 1
        if (dryRun) return
        const contentHash = hashContent([
          row.job_title,
          row.job_apply_url,
          row.job_location,
          row.job_posted_at,
          newDescription.slice(0, 4_000),
        ])
        await pool.query(
          `UPDATE jobs
              SET description = $2,
                  content_hash = decode($3, 'hex'),
                  updated_at = now()
            WHERE id = $1`,
          [row.job_id, newDescription, contentHash]
        )
        updated += 1
      })
    )
  )

  console.log(
    `[backfill-icims-descriptions] enriched=${enriched} updated=${updated} unchanged=${unchanged} fetchFailed=${fetchFailed} skipped=${skipped}`
  )
  await pool.end()
}

main().catch((error) => {
  console.error("[backfill-icims-descriptions] fatal:", error)
  process.exit(1)
})
