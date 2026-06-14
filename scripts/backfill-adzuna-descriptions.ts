/**
 * Hide Adzuna jobs with thin descriptions from the feed.
 *
 * Adzuna's redirect URLs use client-side JS tracking — server-side back-fetching
 * is not viable. Jobs with descriptions < 400 chars are typically staffing-agency
 * stubs with no real content. Mark them `hidden_low_quality` so they're kept in
 * the DB for dedup purposes but excluded from the feed.
 *
 * The ingest cron already applies this filter to new jobs. This script backfills
 * the existing ~17k affected rows.
 *
 * Usage:
 *   npx tsx scripts/backfill-adzuna-descriptions.ts               # dry-run
 *   npx tsx scripts/backfill-adzuna-descriptions.ts --execute
 */

import { loadEnvConfig } from "@next/env"
import { Pool } from "pg"

loadEnvConfig(process.cwd())

const execute = process.argv.includes("--execute")
const MAX_CHARS = 400

async function main() {
  const connectionString = process.env.DATABASE_URL ?? process.env.TARGET_POSTGRES_URL
  if (!connectionString) { console.error("Missing DATABASE_URL"); process.exit(1) }

  const pool = new Pool({
    connectionString,
    ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false },
  })

  const { rows: [{ n }] } = await pool.query<{ n: string }>(
    `SELECT count(*) AS n
     FROM jobs
     WHERE is_active = true
       AND external_id ILIKE 'adzuna:%'
       AND COALESCE(publication_status, 'published') = 'published'
       AND (description IS NULL OR length(description) < $1)`,
    [MAX_CHARS]
  )
  console.log(`${execute ? "EXECUTE" : "DRY-RUN"} — ${n} Adzuna jobs with description < ${MAX_CHARS} chars to hide`)

  if (!execute) {
    const { rows: samples } = await pool.query(
      `SELECT title, length(description) AS len
       FROM jobs
       WHERE is_active = true
         AND external_id ILIKE 'adzuna:%'
         AND COALESCE(publication_status,'published') = 'published'
         AND (description IS NULL OR length(description) < $1)
       ORDER BY first_detected_at DESC LIMIT 10`,
      [MAX_CHARS]
    )
    console.log("\nSample jobs that would be hidden:")
    samples.forEach((r) => console.log(`  [${r.len ?? 0} chars] ${r.title}`))
    console.log("\nRun with --execute to apply.")
    await pool.end()
    return
  }

  const { rowCount } = await pool.query(
    `UPDATE jobs
     SET publication_status = 'hidden_low_quality', updated_at = now()
     WHERE is_active = true
       AND external_id ILIKE 'adzuna:%'
       AND COALESCE(publication_status, 'published') = 'published'
       AND (description IS NULL OR length(description) < $1)`,
    [MAX_CHARS]
  )

  console.log(`Done. Hidden ${rowCount} low-quality Adzuna jobs from the feed.`)
  await pool.end()
}

main().catch((e) => { console.error(e.message); process.exit(1) })
