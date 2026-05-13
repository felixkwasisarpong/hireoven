/**
 * GET /api/jobs/title-suggest?q=<prefix>&limit=15
 *
 * Returns popular `normalized_title` values matching the prefix (or substring),
 * after light cleanup of salary/hour qualifiers and "Full Time / Part Time"
 * suffixes that dominate the raw column. Used by the Job-title filter
 * typeahead on the feed page.
 *
 * Non-tech first — orders by usage frequency, not category, so the same
 * endpoint serves nurses, electricians, sales associates, etc.
 */

import { NextRequest, NextResponse } from "next/server"
import { getPostgresPool } from "@/lib/postgres/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAX_LIMIT = 25
const DEFAULT_LIMIT = 15
const MIN_QUERY_LENGTH = 2
const MIN_OCCURRENCES = 2

export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim()
  if (q.length < MIN_QUERY_LENGTH) {
    return NextResponse.json({ titles: [] })
  }
  const limitParam = Number.parseInt(request.nextUrl.searchParams.get("limit") ?? "", 10)
  const limit = Number.isFinite(limitParam) && limitParam > 0
    ? Math.min(limitParam, MAX_LIMIT)
    : DEFAULT_LIMIT

  const pool = getPostgresPool()
  // Cleanup pipeline:
  //  - strip leading salary patterns like "$28/hr ", "$10,000 Retention bonus - "
  //  - strip trailing "– Full Time" / "- Part Time" / " FT" / " PT" qualifiers
  //  - collapse whitespace
  // Done in SQL so the suggestion list is the same across callers and we can
  // GROUP BY the cleaned form.
  const cleanupSql = `
    trim(
      regexp_replace(
        regexp_replace(
          regexp_replace(normalized_title,
            '^\\$[0-9.,]+\\s*(/?hr|/?hour|k|/yr|/year)?\\s*[-–—]?\\s*', '', 'i'),
          '\\s*[-–—/]\\s*(full[ -]?time|part[ -]?time|ft|pt|temporary|temp|contract|contract[ -]?to[ -]?hire)\\s*$', '', 'i'),
        '\\s+', ' ', 'g'
      )
    )
  `
  try {
    const { rows } = await pool.query<{ title: string; n: number }>(
      `WITH cleaned AS (
         SELECT ${cleanupSql} AS title
         FROM jobs
         WHERE is_active = true
           AND normalized_title IS NOT NULL
       )
       SELECT title, COUNT(*)::int AS n
       FROM cleaned
       WHERE title <> ''
         AND title ILIKE $1
       GROUP BY title
       HAVING COUNT(*) >= $3
       ORDER BY (title ILIKE $2) DESC, n DESC, title ASC
       LIMIT $4`,
      [`%${q}%`, `${q}%`, MIN_OCCURRENCES, limit]
    )
    return NextResponse.json({ titles: rows })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Title suggestion failed"
    return NextResponse.json({ error: message, titles: [] }, { status: 500 })
  }
}
