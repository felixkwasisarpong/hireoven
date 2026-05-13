/**
 * Rebuild the `title_suggestions` table from the current `jobs` snapshot.
 *
 *   npx tsx scripts/refresh-title-suggestions.ts
 *
 * Strips salary/hour prefixes and "Full Time / Part Time" suffixes from
 * `jobs.normalized_title`, groups the cleaned forms, and keeps any title
 * that appears at least twice. Backs the /api/jobs/title-suggest endpoint.
 *
 * Wall time: ~5s on 330k rows; the table ends up ~30-70k rows. Run after
 * large ingests or on a nightly cron.
 */

import { loadEnvConfig } from "@next/env"
import { getPostgresPool } from "@/lib/postgres/server"

loadEnvConfig(process.cwd())

const MIN_OCCURRENCES = 2

const CLEANUP_SQL = `
  trim(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          normalized_title,
          '^\\$[0-9.,]+\\s*(/?hr|/?hour|k|/yr|/year)?\\s*[-–—]?\\s*', '', 'i'),
        '\\s*[-–—/]\\s*(full[ -]?time|part[ -]?time|ft|pt|temporary|temp|contract|contract[ -]?to[ -]?hire)\\s*$', '', 'i'),
      '\\s+', ' ', 'g'
    )
  )
`

async function main() {
  const startedAt = Date.now()
  const pool = getPostgresPool()
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    await client.query("TRUNCATE title_suggestions")
    const result = await client.query(
      `INSERT INTO title_suggestions (title, n, refreshed_at)
       SELECT title, COUNT(*)::int AS n, now()
       FROM (
         SELECT ${CLEANUP_SQL} AS title
         FROM jobs
         WHERE is_active = true AND normalized_title IS NOT NULL
       ) c
       WHERE title <> ''
       GROUP BY title
       HAVING COUNT(*) >= $1`,
      [MIN_OCCURRENCES]
    )
    await client.query("COMMIT")
    const durationMs = Date.now() - startedAt
    console.log(
      `[refresh-title-suggestions] inserted=${result.rowCount} duration=${durationMs}ms`
    )
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch((error) => {
  console.error("[refresh-title-suggestions] fatal:", error)
  process.exit(1)
})
