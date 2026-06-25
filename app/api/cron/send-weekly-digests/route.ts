import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/env"
import { getPostgresPool } from "@/lib/postgres/server"
import { generateWeeklyDigest, isoWeek } from "@/lib/email/digests/weekly"
import { renderWeeklyDigest } from "@/lib/email/templates/weekly-digest"
import { generateUnsubscribeToken } from "@/lib/email/unsubscribe"
import { unsubscribeUrl, unsubscribePostUrl } from "@/lib/email/templates/layout"
import { sendManaged } from "@/lib/email/provider"

export const runtime = "nodejs"
export const maxDuration = 300
export const dynamic = "force-dynamic"

// Schedule: hourly (timezone-local 8am means we must check every hour).
//   0 * * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" .../api/cron/send-weekly-digests
//
// Selects users whose weekly_send_day == their local weekday AND weekly_send_hour ==
// their local hour right now, generates each digest (skipping empties), and sends
// with idempotency via dedupe_key = weekly:<user>:<iso-week>.

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

function localDayHour(tz: string, now: Date): { day: number; hour: number } | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      hour: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now)
    const wd = parts.find((p) => p.type === "weekday")?.value ?? ""
    const hr = parts.find((p) => p.type === "hour")?.value ?? ""
    const day = WEEKDAYS.indexOf(wd)
    const hour = Number(hr)
    if (day < 0 || Number.isNaN(hour)) return null
    return { day, hour }
  } catch {
    return null
  }
}

export async function GET(request: NextRequest) {
  if (!requireCronAuth(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const start = Date.now()
  const now = new Date()
  const week = isoWeek(now)
  const pool = getPostgresPool()

  // Opted-in users only (explicit prefs row with weekly_digest = true).
  const { rows } = await pool.query<{
    user_id: string
    email: string | null
    timezone: string
    weekly_send_day: number
    weekly_send_hour: number
  }>(
    `SELECT pr.user_id::text, prof.email, pr.timezone, pr.weekly_send_day, pr.weekly_send_hour
     FROM user_email_preferences pr
     JOIN profiles prof ON prof.id = pr.user_id
     WHERE pr.weekly_digest = true AND prof.email IS NOT NULL`
  )

  let considered = 0
  let sent = 0
  let skippedEmpty = 0
  const results: Record<string, number> = {}

  for (const u of rows) {
    const local = localDayHour(u.timezone, now)
    if (!local || local.day !== u.weekly_send_day || local.hour !== u.weekly_send_hour) continue
    considered++

    const token = await generateUnsubscribeToken(u.user_id, "weekly_digest")
    const data = await generateWeeklyDigest(u.user_id, unsubscribeUrl(token))
    if (!data) {
      skippedEmpty++
      continue
    }
    const rendered = renderWeeklyDigest(data)
    const result = await sendManaged({
      userId: u.user_id,
      emailType: "weekly_digest",
      dedupeKey: `weekly:${u.user_id}:${week}`,
      toEmail: u.email!,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      unsubscribeUrl: unsubscribePostUrl(token),
    })
    results[result] = (results[result] ?? 0) + 1
    if (result === "sent") sent++
  }

  return NextResponse.json({
    ok: true,
    week,
    candidates: rows.length,
    considered,
    sent,
    skipped_empty: skippedEmpty,
    results,
    duration_ms: Date.now() - start,
  })
}
