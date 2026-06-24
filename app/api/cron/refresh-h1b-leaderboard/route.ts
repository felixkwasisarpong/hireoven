import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/env"
import { getPostgresPool } from "@/lib/postgres/server"

export const runtime = "nodejs"
export const maxDuration = 300
export const dynamic = "force-dynamic"

// Schedule: nightly at 3am UTC (harvester-box crontab):
//   0 3 * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" \
//     https://hireoven.com/api/cron/refresh-h1b-leaderboard >> /var/log/hireoven-cron.log 2>&1
//
// Refreshes the leaderboard materialized view created in
// scripts/migrations/add-h1b-leaderboard-mv.sql. CONCURRENTLY keeps public reads
// lock-free (requires the UNIQUE index on company_id, and a prior non-concurrent
// REFRESH so the view is already populated — see the migration's APPLY steps).

export async function GET(request: NextRequest) {
  if (!requireCronAuth(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const start = Date.now()
  try {
    const pool = getPostgresPool()
    await pool.query("REFRESH MATERIALIZED VIEW CONCURRENTLY h1b_leaderboard_mv")
    const { rows } = await pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM h1b_leaderboard_mv"
    )
    return NextResponse.json({
      ok: true,
      source: "h1b_leaderboard_mv",
      row_count: Number(rows[0]?.count ?? 0),
      refreshed_at: new Date().toISOString(),
      duration_ms: Date.now() - start,
    })
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        duration_ms: Date.now() - start,
      },
      { status: 500 }
    )
  }
}
