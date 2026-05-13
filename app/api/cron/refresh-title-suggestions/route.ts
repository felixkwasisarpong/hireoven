/**
 * GET /api/cron/refresh-title-suggestions
 *
 * Rebuilds the `title_suggestions` lookup table from the current `jobs`
 * snapshot. Backs the Job-title typeahead on the feed; live aggregation
 * over the 327k-row jobs table was ~2.6s per keystroke, this table is
 * ~34k rows and ~30ms.
 *
 * Strips salary/hour prefixes and "Full Time / Part Time" suffixes from
 * `normalized_title`, groups the cleaned forms, keeps any title with
 * >= 2 occurrences. Mirrors scripts/refresh-title-suggestions.ts so the
 * Coolify cron can run via curl without invoking tsx in the container.
 *
 * Schedule: nightly (e.g. `30 3 * * *` UTC), after the bulk of the
 * crawl/harvest crons have settled.
 */

import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/env"
import { getPostgresPool } from "@/lib/postgres/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

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

export async function GET(request: NextRequest) {
  if (!requireCronAuth(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

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
    return NextResponse.json({
      success: true,
      inserted: result.rowCount,
      durationMs: Date.now() - startedAt,
    })
  } catch (error) {
    await client.query("ROLLBACK")
    const message = error instanceof Error ? error.message : "Refresh failed"
    return NextResponse.json({ error: message }, { status: 500 })
  } finally {
    client.release()
  }
}
