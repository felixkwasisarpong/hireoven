import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/env"
import { getPostgresPool } from "@/lib/postgres/server"
import { layoffSourceKind } from "@/lib/h1b/layoff-signal"
import { h1bSponsorPath } from "@/lib/seo/company-seo"
import { renderLayoffAlert } from "@/lib/email/templates/layoff-alert"
import { generateUnsubscribeToken } from "@/lib/email/unsubscribe"
import { unsubscribeUrl, unsubscribePostUrl, appUrl } from "@/lib/email/templates/layout"
import { sendManaged } from "@/lib/email/provider"

export const runtime = "nodejs"
export const maxDuration = 300
export const dynamic = "force-dynamic"

// Schedule: every ~15 min (instant-ish). Finds layoff events from the last 3 days on
// watched companies and emails each watcher who opted in. Debounce: at most one
// layoff alert per user per company per 24h — additional events roll into the weekly
// digest. Future-dated events are not alerted until their event_date arrives.

export async function GET(request: NextRequest) {
  if (!requireCronAuth(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const start = Date.now()
  const pool = getPostgresPool()

  const { rows } = await pool.query<{
    event_id: string
    company_id: string
    name: string
    source: string
    event_date: string
    employees_affected: number | null
    location: string | null
    user_id: string
    email: string
    events_12mo: number
  }>(
    `SELECT le.id::text AS event_id, le.company_id::text, c.name, le.source, le.event_date,
            le.employees_affected, le.location, w.user_id::text, prof.email,
            (SELECT COUNT(*) FROM layoff_events le2
              WHERE le2.company_id = le.company_id AND le2.event_date > NOW() - INTERVAL '12 months')::int AS events_12mo
     FROM layoff_events le
     JOIN companies c ON c.id = le.company_id
     JOIN watchlist w ON w.company_id = le.company_id
     JOIN profiles prof ON prof.id = w.user_id
     LEFT JOIN user_email_preferences pr ON pr.user_id = w.user_id
     WHERE le.event_date <= CURRENT_DATE
       AND le.event_date > NOW() - INTERVAL '3 days'
       AND COALESCE(pr.layoff_alerts, true) = true
       AND prof.email IS NOT NULL
     ORDER BY le.event_date DESC`
  )

  let sent = 0
  let debounced = 0
  const results: Record<string, number> = {}

  for (const r of rows) {
    // 24h debounce: skip if this user already got a layoff alert for this company recently.
    const recent = await pool.query(
      `SELECT 1 FROM email_sends
       WHERE user_id = $1 AND email_type = 'layoff_alert'
         AND dedupe_key LIKE $2 AND status = 'sent' AND sent_at > NOW() - INTERVAL '24 hours' LIMIT 1`,
      [r.user_id, `layoff:${r.user_id}:${r.company_id}:%`]
    )
    if (recent.rows.length) {
      debounced++
      continue
    }

    const token = await generateUnsubscribeToken(r.user_id, "layoff_alert")
    const rendered = renderLayoffAlert({
      companyName: r.name,
      source: layoffSourceKind(r.source),
      eventDate: new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(r.event_date)),
      employeesAffected: r.employees_affected,
      location: r.location,
      nthEvent: r.events_12mo || 1,
      signalUrl: appUrl(h1bSponsorPath(r.company_id, r.name)),
      rolesUrl: appUrl("/h1b-sponsors/leaderboard"),
      unsubscribeUrl: unsubscribeUrl(token),
    })
    const result = await sendManaged({
      userId: r.user_id,
      emailType: "layoff_alert",
      dedupeKey: `layoff:${r.user_id}:${r.company_id}:${r.event_id}`,
      toEmail: r.email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      unsubscribeUrl: unsubscribePostUrl(token),
    })
    results[result] = (results[result] ?? 0) + 1
    if (result === "sent") sent++
  }

  return NextResponse.json({ ok: true, candidates: rows.length, sent, debounced, results, duration_ms: Date.now() - start })
}
