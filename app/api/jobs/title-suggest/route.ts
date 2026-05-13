/**
 * GET /api/jobs/title-suggest?q=<prefix>&limit=15
 *
 * Reads from the pre-aggregated `title_suggestions` table populated by
 * scripts/refresh-title-suggestions.ts. The live-aggregation variant ran
 * ~2.6s per keystroke against the 327k-row jobs table; this lookup is ~30ms.
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
  try {
    const { rows } = await pool.query<{ title: string; n: number }>(
      `SELECT title, n FROM title_suggestions
       WHERE title ILIKE $1
       ORDER BY (title ILIKE $2) DESC, n DESC, title ASC
       LIMIT $3`,
      [`%${q}%`, `${q}%`, limit]
    )
    return NextResponse.json({ titles: rows })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Title suggestion failed"
    return NextResponse.json({ error: message, titles: [] }, { status: 500 })
  }
}
