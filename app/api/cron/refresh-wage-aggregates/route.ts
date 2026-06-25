import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/env"
import { getPostgresPool } from "@/lib/postgres/server"

export const runtime = "nodejs"
export const maxDuration = 300

// Nightly at 4am UTC (1h after the leaderboard refresh — same data box).
//   0 4 * * * flock -n /tmp/hireoven-wage-agg.lock -c 'cd $HIREOVEN_REPO && curl ...'
// CONCURRENTLY keeps public reads lock-free (requires the unique index + a populated view).
export async function GET(request: NextRequest) {
  if (!requireCronAuth(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const start = Date.now()
  try {
    const pool = getPostgresPool()
    await pool.query("REFRESH MATERIALIZED VIEW CONCURRENTLY lca_wage_aggregates_mv")
    const { rows } = await pool.query<{ n: string }>(
      "SELECT COUNT(*)::text AS n FROM lca_wage_aggregates_mv"
    )
    return NextResponse.json({
      ok: true,
      rows: Number(rows[0]?.n ?? 0),
      duration_ms: Date.now() - start,
    })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err), duration_ms: Date.now() - start },
      { status: 500 }
    )
  }
}
