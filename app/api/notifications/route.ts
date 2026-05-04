import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres/server"
import type { AlertNotificationWithDetails } from "@/types"

export const runtime = "nodejs"

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const sp = request.nextUrl.searchParams
  const filter = sp.get("filter") ?? "all"
  const limit = Math.min(100, parseInt(sp.get("limit") ?? "20", 10))
  const offset = parseInt(sp.get("offset") ?? "0", 10)

  const where = ["n.user_id = $1"]
  const values: unknown[] = [user.id]
  const addParam = (v: unknown) => { values.push(v); return `$${values.length}` }

  if (filter === "unread") where.push(`n.opened_at IS NULL`)
  if (filter === "alerts") where.push(`n.notification_type = ${addParam("alert")}`)
  if (filter === "watchlist") where.push(`n.notification_type = ${addParam("watchlist")}`)

  const pool = getPostgresPool()
  const [notifResult, countResult] = await Promise.all([
    pool.query<AlertNotificationWithDetails>(
      `SELECT n.*,
              to_jsonb(j.*) || jsonb_build_object(
                'company', to_jsonb(c.*),
                'match_score', COALESCE(ms.match_score, 'null'::jsonb)
              ) AS job,
              to_jsonb(a.*) AS alert
       FROM alert_notifications n
       LEFT JOIN jobs j ON j.id = n.job_id
       LEFT JOIN companies c ON c.id = j.company_id
       LEFT JOIN LATERAL (
         SELECT to_jsonb(s.*) AS match_score
         FROM job_match_scores s
         WHERE s.user_id = n.user_id
           AND s.job_id = n.job_id
         ORDER BY s.computed_at DESC
         LIMIT 1
       ) ms ON true
       LEFT JOIN job_alerts a ON a.id = n.alert_id
       WHERE ${where.join(" AND ")}
       ORDER BY n.sent_at DESC
       LIMIT ${addParam(limit)} OFFSET ${addParam(offset)}`,
      values
    ),
    pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c
       FROM alert_notifications
       WHERE user_id = $1 AND opened_at IS NULL`,
      [user.id]
    ),
  ])

  return NextResponse.json({
    notifications: notifResult.rows,
    unreadCount: Number(countResult.rows[0]?.c ?? 0),
  })
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = (await request.json().catch(() => ({}))) as {
    id?: string
    markAllRead?: boolean
  }

  const pool = getPostgresPool()

  if (body.markAllRead) {
    await pool.query(
      `UPDATE alert_notifications
       SET opened_at = now()
       WHERE user_id = $1 AND opened_at IS NULL`,
      [user.id]
    )
    return NextResponse.json({ ok: true })
  }

  if (body.id) {
    await pool.query(
      `UPDATE alert_notifications
       SET opened_at = COALESCE(opened_at, now())
       WHERE id = $1 AND user_id = $2`,
      [body.id, user.id]
    )
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: "id or markAllRead required" }, { status: 400 })
}
