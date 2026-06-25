import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/env"
import { getPostgresPool } from "@/lib/postgres/server"
import { isoWeek } from "@/lib/email/digests/weekly"

export const runtime = "nodejs"
export const maxDuration = 120
export const dynamic = "force-dynamic"

// Schedule: daily. Upserts the current ISO week's leaderboard ranks from
// h1b_leaderboard_mv into leaderboard_rank_history. Daily upsert keeps the current
// week fresh while prior weeks stay frozen, so the weekly digest can compute real
// week-over-week movers. Reads only the MV (indexed, bounded) — web-box safe.

export async function GET(request: NextRequest) {
  if (!requireCronAuth(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const start = Date.now()
  const week = isoWeek()
  const pool = getPostgresPool()

  const res = await pool.query(
    `INSERT INTO leaderboard_rank_history (company_id, iso_week, rank_volume, rank_cert_rate)
     SELECT company_id, $1, rank_volume, rank_cert_rate FROM h1b_leaderboard_mv
     ON CONFLICT (company_id, iso_week)
     DO UPDATE SET rank_volume = EXCLUDED.rank_volume, rank_cert_rate = EXCLUDED.rank_cert_rate, captured_at = NOW()`,
    [week]
  )

  return NextResponse.json({ ok: true, week, rows: res.rowCount ?? 0, duration_ms: Date.now() - start })
}
