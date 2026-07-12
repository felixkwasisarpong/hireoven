import { getPostgresPool } from "@/lib/postgres/server"
import { sendManaged } from "@/lib/email/provider"
import { getHireovenEmailLogoUrl } from "@/lib/email/branding"

// Booking-confirmation email for a scheduled live interview: when it is, a
// join link, and add-to-calendar links (ICS download + Google Calendar).
// Best-effort — a failed send must never fail the booking.

function getBaseUrl() {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
}

function esc(value: string) {
  return value
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;")
}

function googleCalendarStamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")
}

export function buildGoogleCalendarUrl(input: {
  scheduledAt: Date
  durationMin: number
  joinUrl: string
  jobTitle?: string | null
  jobCompany?: string | null
}): string {
  const end = new Date(input.scheduledAt.getTime() + input.durationMin * 60_000)
  const title = input.jobTitle
    ? `Live mock interview — ${input.jobTitle}${input.jobCompany ? ` @ ${input.jobCompany}` : ""}`
    : "Live mock interview — Hireoven"
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: title,
    dates: `${googleCalendarStamp(input.scheduledAt)}/${googleCalendarStamp(end)}`,
    details: `Your ${input.durationMin}-minute live AI mock interview on Hireoven.\nJoin here: ${input.joinUrl}`,
    location: input.joinUrl,
  })
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

export async function sendScheduleConfirmationEmail(input: {
  userId: string
  sessionId: string
  scheduledAt: Date
  timeZone: string | null
  durationMin: number
  jobTitle?: string | null
  jobCompany?: string | null
}): Promise<void> {
  const pool = getPostgresPool()
  const result = await pool.query<{ email: string | null; full_name: string | null }>(
    `SELECT email, full_name FROM profiles WHERE id = $1 LIMIT 1`,
    [input.userId]
  )
  const profile = result.rows[0]
  if (!profile?.email) return

  const base = getBaseUrl()
  const joinUrl = `${base}/dashboard/interview/live/${input.sessionId}`
  const detailsUrl = `${base}/dashboard/interview/scheduled/${input.sessionId}`
  const icsUrl = `${base}/api/interview/sessions/${input.sessionId}/calendar.ics`
  const googleUrl = buildGoogleCalendarUrl({
    scheduledAt: input.scheduledAt,
    durationMin: input.durationMin,
    joinUrl,
    jobTitle: input.jobTitle,
    jobCompany: input.jobCompany,
  })

  const timeZone = input.timeZone ?? "UTC"
  const whenLabel = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long", month: "long", day: "numeric",
    hour: "numeric", minute: "2-digit", timeZoneName: "short",
  }).format(input.scheduledAt)

  const roleLine = input.jobTitle
    ? `${input.jobTitle}${input.jobCompany ? ` @ ${input.jobCompany}` : ""}`
    : "General practice"

  const subject = `Interview scheduled — ${whenLabel}`
  const text =
    `Your live mock interview is scheduled.\n\n` +
    `When: ${whenLabel}\n` +
    `Role: ${roleLine}\n` +
    `Duration: ${input.durationMin} minutes\n\n` +
    `Join: ${joinUrl}\n` +
    `Add to calendar (ICS): ${icsUrl}\n` +
    `Add to Google Calendar: ${googleUrl}\n\n` +
    `We'll remind you in the app before it starts. Manage the booking: ${detailsUrl}`

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#f3f2ef;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f2ef;padding:24px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:584px;" cellpadding="0" cellspacing="0">
        <tr><td style="padding:0 0 16px;">
          <img src="${getHireovenEmailLogoUrl("wordmark")}" alt="Hireoven" height="28"
               style="display:block;height:28px;width:auto;border:0;" />
        </td></tr>
        <tr><td style="background:#ffffff;border-radius:8px;border:1px solid #e2e8f0;padding:24px;">
          <div style="font-size:22px;font-weight:800;color:#0f172a;margin-bottom:4px;">You're booked ✅</div>
          <div style="font-size:14px;color:#64748b;margin-bottom:20px;">Your live mock interview is scheduled. We'll remind you before it starts.</div>
          <table cellpadding="0" cellspacing="0" style="width:100%;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">
            <tr><td style="padding:16px 18px;">
              <div style="font-size:15px;font-weight:700;color:#0f172a;margin-bottom:6px;">${esc(whenLabel)}</div>
              <div style="font-size:13px;color:#475569;">${esc(roleLine)} · ${input.durationMin} min live session</div>
            </td></tr>
          </table>
          <table cellpadding="0" cellspacing="0" style="margin-top:20px;">
            <tr>
              <td>
                <a href="${esc(googleUrl)}"
                   style="display:inline-block;background:#FF5C18;color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:999px;font-size:13.5px;font-weight:700;">
                  Add to Google Calendar
                </a>
              </td>
              <td style="padding-left:10px;">
                <a href="${esc(icsUrl)}"
                   style="display:inline-block;border:1.5px solid #FF5C18;color:#FF5C18;text-decoration:none;padding:10px 20px;border-radius:999px;font-size:13.5px;font-weight:700;">
                  Download .ics
                </a>
              </td>
            </tr>
          </table>
          <div style="font-size:13px;color:#64748b;margin-top:20px;line-height:1.6;">
            When it's time, join from the reminder or directly:<br/>
            <a href="${esc(joinUrl)}" style="color:#FF5C18;">${esc(joinUrl)}</a><br/>
            Need to reschedule or cancel? <a href="${esc(detailsUrl)}" style="color:#64748b;">Manage this booking</a>.
          </div>
        </td></tr>
        <tr><td style="padding:20px 4px 0;">
          <div style="font-size:11px;color:#94a3b8;">&copy; ${new Date().getFullYear()} Hireoven. Jobs served fresh.</div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`

  await sendManaged({
    userId: input.userId,
    emailType: "interview_schedule",
    dedupeKey: `interview-schedule-${input.sessionId}-${input.scheduledAt.toISOString()}`,
    toEmail: profile.email,
    subject,
    html,
    text,
  })
}
