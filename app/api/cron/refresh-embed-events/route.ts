import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/env"
import { getPostgresPool } from "@/lib/postgres/server"

export const runtime = "nodejs"
export const maxDuration = 120
export const dynamic = "force-dynamic"

// Schedule: hourly (harvester-box crontab):
//   17 * * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" \
//     https://hireoven.com/api/cron/refresh-embed-events >> /var/log/hireoven-cron.log 2>&1
//
// Refreshes the embed-impression daily rollup (scripts/migrations/add-embed-tokens-events.sql)
// that powers view counts on the dashboard. CONCURRENTLY keeps reads lock-free
// (requires the UNIQUE index + an already-populated view; the migration's initial
// CREATE populates it). embed_events is append-only and indexed, so this is cheap.

export async function GET(request: NextRequest) {
  if (!requireCronAuth(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const start = Date.now()
  try {
    const pool = getPostgresPool()
    await pool.query("REFRESH MATERIALIZED VIEW CONCURRENTLY embed_event_daily_mv")
    const { rows } = await pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM embed_event_daily_mv"
    )
    return NextResponse.json({
      ok: true,
      source: "embed_event_daily_mv",
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
