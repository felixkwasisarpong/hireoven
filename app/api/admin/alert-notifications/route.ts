import { NextResponse } from "next/server"
import { assertAdminAccess } from "@/lib/admin/auth"
import { getPostgresPool } from "@/lib/postgres/server"

export async function GET() {
  const access = await assertAdminAccess()
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const pool = getPostgresPool()
  const [logResult, statsResult, triggeredResult] = await Promise.all([
    pool.query(
      `SELECT n.*,
              to_jsonb(j.*) || jsonb_build_object('company', to_jsonb(c.*)) AS job,
              to_jsonb(a.*) AS alert,
              CASE WHEN p.id IS NULL THEN NULL
                   ELSE jsonb_build_object('email', p.email, 'full_name', p.full_name)
              END AS "user"
       FROM alert_notifications n
       LEFT JOIN jobs j ON j.id = n.job_id
       LEFT JOIN companies c ON c.id = j.company_id
       LEFT JOIN job_alerts a ON a.id = n.alert_id
       LEFT JOIN profiles p ON p.id = n.user_id
       ORDER BY n.sent_at DESC
       LIMIT 500`
    ),
    // The log above is a 500-row page; rates computed from it lie once daily
    // volume passes the cap, so today's stats come straight from the table.
    pool.query<{ sent_today: string; opened_today: string; clicked_today: string }>(
      `SELECT COUNT(*)::text AS sent_today,
              COUNT(opened_at)::text AS opened_today,
              COUNT(clicked_at)::text AS clicked_today
       FROM alert_notifications
       WHERE sent_at > now() - interval '24 hours'`
    ),
    pool.query<{ name: string; sends: string }>(
      `SELECT CASE
                WHEN n.notification_type = 'watchlist' THEN 'Watchlist'
                ELSE COALESCE(a.name, 'Unnamed alert')
              END AS name,
              COUNT(*)::text AS sends
       FROM alert_notifications n
       LEFT JOIN job_alerts a ON a.id = n.alert_id
       WHERE n.sent_at > now() - interval '30 days'
       GROUP BY 1
       ORDER BY COUNT(*) DESC
       LIMIT 5`
    ),
  ])

  const stats = statsResult.rows[0]
  const sentToday = Number(stats?.sent_today ?? 0)
  const openedToday = Number(stats?.opened_today ?? 0)
  const clickedToday = Number(stats?.clicked_today ?? 0)
  return NextResponse.json({
    notifications: logResult.rows,
    stats: {
      sentToday,
      openedToday,
      clickedToday,
      openRate: sentToday ? Math.round((openedToday / sentToday) * 100) : 0,
      clickRate: sentToday ? Math.round((clickedToday / sentToday) * 100) : 0,
    },
    mostTriggered: triggeredResult.rows.map((row) => ({
      name: row.name,
      sends: Number(row.sends),
    })),
  })
}
