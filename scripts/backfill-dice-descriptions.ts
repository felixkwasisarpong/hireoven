/**
 * One-shot backfill: fetch real job descriptions for existing Dice jobs
 * that currently have only the 500-char search-result summary.
 *
 *   npx tsx scripts/backfill-dice-descriptions.ts                       # dry-run
 *   npx tsx scripts/backfill-dice-descriptions.ts --execute
 *   npx tsx scripts/backfill-dice-descriptions.ts --execute --limit=2000
 *   npx tsx scripts/backfill-dice-descriptions.ts --execute --min-length=800
 *
 * For each Dice job with `length(description) < min-length`:
 *   1. Derive the canonical detail URL from apply_url (or the Dice id)
 *   2. GET the page and extract the JobPosting JSON-LD description
 *   3. UPDATE description if the new text is longer than what's stored
 *
 * Idempotent — re-runs only touch jobs still under the min-length threshold.
 */

import { loadEnvConfig } from "@next/env"
import pLimit from "p-limit"
import { fetchDiceJobDescription } from "@/lib/sources/dice"
import { getPostgresPool } from "@/lib/postgres/server"

loadEnvConfig(process.cwd())

const args = process.argv.slice(2)
const dryRun = !args.includes("--execute")

function getArg(prefix: string): string | undefined {
  return args.find((a) => a.startsWith(prefix))?.split("=")[1]
}

const limit = Math.max(1, Number.parseInt(getArg("--limit=") ?? "1000", 10))
const concurrency = Math.max(1, Number.parseInt(getArg("--concurrency=") ?? "3", 10))
const minLength = Math.max(0, Number.parseInt(getArg("--min-length=") ?? "800", 10))

type CandidateRow = {
  job_id: string
  job_apply_url: string
  external_id: string | null
  job_description: string | null
}

async function loadCandidates(): Promise<CandidateRow[]> {
  const pool = getPostgresPool()
  const { rows } = await pool.query<CandidateRow>(
    `SELECT id          AS job_id,
            apply_url   AS job_apply_url,
            external_id AS external_id,
            description AS job_description
       FROM jobs
      WHERE is_active = true
        AND apply_url ILIKE '%dice.com%'
        AND (description IS NULL OR length(description) < $2)
      ORDER BY first_detected_at DESC NULLS LAST
      LIMIT $1`,
    [limit, minLength]
  )
  return rows
}

/**
 * Build the canonical Dice detail URL. Prefer the stored apply_url when it
 * already points at `/job-detail/{id}`; otherwise reconstruct from the
 * `dice:{id}` external_id.
 */
function detailUrlFor(row: CandidateRow): string | null {
  if (row.job_apply_url.startsWith("https://www.dice.com/job-detail/")) {
    return row.job_apply_url
  }
  const diceId = row.external_id?.startsWith("dice:") ? row.external_id.slice(5) : null
  if (!diceId) return null
  return `https://www.dice.com/job-detail/${diceId}`
}

async function main() {
  console.log(
    `[backfill-dice-descriptions] mode=${dryRun ? "dry-run" : "execute"} limit=${limit} concurrency=${concurrency} min-length=${minLength}`
  )

  const candidates = await loadCandidates()
  console.log(`[backfill-dice-descriptions] loaded ${candidates.length} candidates`)
  if (candidates.length === 0) {
    return
  }

  let skippedNoUrl = 0
  let fetchFailed = 0
  let unchanged = 0
  let enriched = 0
  let updated = 0
  let processed = 0
  const total = candidates.length

  const limiter = pLimit(concurrency)
  const pool = getPostgresPool()
  const progressEvery = Math.max(50, Math.floor(total / 20))

  await Promise.all(
    candidates.map((row) =>
      limiter(async () => {
        const url = detailUrlFor(row)
        processed += 1
        if (processed % progressEvery === 0) {
          console.log(
            `[backfill-dice-descriptions] progress ${processed}/${total} enriched=${enriched} fetchFailed=${fetchFailed} unchanged=${unchanged}`
          )
        }

        if (!url) {
          skippedNoUrl += 1
          return
        }
        const newDescription = await fetchDiceJobDescription(url)
        if (!newDescription) {
          fetchFailed += 1
          return
        }
        if (newDescription.length <= (row.job_description?.length ?? 0)) {
          unchanged += 1
          return
        }
        enriched += 1

        if (dryRun) return

        await pool.query(
          `UPDATE jobs
              SET description = $2,
                  updated_at = now()
            WHERE id = $1`,
          [row.job_id, newDescription]
        )
        updated += 1
      })
    )
  )

  console.log(
    `[backfill-dice-descriptions] done enriched=${enriched} updated=${updated} unchanged=${unchanged} fetchFailed=${fetchFailed} skippedNoUrl=${skippedNoUrl}`
  )
  await pool.end()
}

main().catch((error) => {
  console.error("[backfill-dice-descriptions] fatal:", error)
  process.exit(1)
})
