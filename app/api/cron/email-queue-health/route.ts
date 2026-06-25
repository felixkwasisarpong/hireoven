import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/env"
import { getPostgresPool } from "@/lib/postgres/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Schedule: every 30 min. Reaps orphaned 'queued' rows (a send that started but never
// resolved — there's no stored body to resend, so the next generator run recreates
// it) and reports deliverability health with alert flags. Sends are immediate, so
// this is a janitor + observability endpoint rather than a worker.

export async function GET(request: NextRequest) {
  if (!requireCronAuth(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const pool = getPostgresPool()

  const reaped = await pool.query(
    `UPDATE email_sends SET status = 'failed', error_message = COALESCE(error_message, 'reaped: stale queued')
     WHERE status = 'queued' AND queued_at < NOW() - INTERVAL '15 minutes'`
  )

  const { rows: byType } = await pool.query<{
    email_type: string
    sent: number
    bounced: number
    failed: number
  }>(
    `SELECT email_type,
            COUNT(*) FILTER (WHERE status = 'sent')::int AS sent,
            COUNT(*) FILTER (WHERE status = 'bounced')::int AS bounced,
            COUNT(*) FILTER (WHERE status = 'failed')::int AS failed
     FROM email_sends WHERE queued_at > NOW() - INTERVAL '7 days'
     GROUP BY email_type ORDER BY email_type`
  )

  const { rows: depth } = await pool.query<{ queued: number }>(
    `SELECT COUNT(*)::int AS queued FROM email_sends WHERE status = 'queued'`
  )

  // Alert thresholds: bounce >3% or complaint surrogate via failed >10%, queue >5000.
  const alerts: string[] = []
  for (const t of byType) {
    const total = t.sent + t.bounced + t.failed
    if (total >= 20 && t.bounced / total > 0.03) alerts.push(`${t.email_type}: bounce rate ${(100 * t.bounced / total).toFixed(1)}%`)
  }
  if ((depth[0]?.queued ?? 0) > 5000) alerts.push(`queue depth ${depth[0].queued}`)

  return NextResponse.json({
    ok: true,
    reaped: reaped.rowCount ?? 0,
    queue_depth: depth[0]?.queued ?? 0,
    by_type: byType,
    alerts,
  })
}
