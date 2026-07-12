import { getPostgresPool } from "@/lib/postgres/server"
import { sendManaged } from "@/lib/email/provider"
import { getHireovenEmailLogoUrl } from "@/lib/email/branding"
import { appUrl, esc } from "@/lib/email/templates/layout"
import { buildGoogleCalendarUrl, roleLabel } from "@/lib/interview/format"

// Booking-confirmation email for a scheduled live interview: when it is, a
// join link, and add-to-calendar links. The Google Calendar link works without
// a Hireoven session; the .ics download requires auth, so the email points at
// the booking page (which offers it) rather than the raw file endpoint.

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

  const joinUrl = appUrl(`/dashboard/interview/live/${input.sessionId}`)
  const detailsUrl = appUrl(`/dashboard/interview/scheduled/${input.sessionId}`)
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

  const roleLine = roleLabel(input.jobTitle, input.jobCompany)

  const subject = `Interview scheduled — ${whenLabel}`
  const text =
    `Your live mock interview is scheduled.\n\n` +
    `When: ${whenLabel}\n` +
    `Role: ${roleLine}\n` +
    `Duration: ${input.durationMin} minutes\n\n` +
    `Join: ${joinUrl}\n` +
    `Add to Google Calendar: ${googleUrl}\n\n` +
    `We'll remind you in the app before it starts.\n` +
    `Manage the booking (reschedule, cancel, download .ics): ${detailsUrl}`

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
                <a href="${esc(detailsUrl)}"
                   style="display:inline-block;border:1.5px solid #FF5C18;color:#FF5C18;text-decoration:none;padding:10px 20px;border-radius:999px;font-size:13.5px;font-weight:700;">
                  Manage booking
                </a>
              </td>
            </tr>
          </table>
          <div style="font-size:13px;color:#64748b;margin-top:20px;line-height:1.6;">
            When it's time, join from the reminder or directly:<br/>
            <a href="${esc(joinUrl)}" style="color:#FF5C18;">${esc(joinUrl)}</a><br/>
            The booking page also offers a downloadable .ics calendar file,
            rescheduling, and cancellation.
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
