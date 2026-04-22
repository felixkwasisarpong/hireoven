import { Resend } from "resend"
import { getWaitlistFromEmail } from "@/lib/email/identity"
import { getPublicSiteUrl } from "@/lib/waitlist/site-url"

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null

const from = getWaitlistFromEmail()

export async function sendWaitlistConfirmationEmail(options: {
  email: string
  token: string
  isInternational?: boolean | null
}) {
  if (!resend) {
    console.warn("[waitlist] RESEND_API_KEY missing - skipping confirmation email")
    return { ok: false as const, error: "Email not configured" }
  }

  const site = getPublicSiteUrl()
  const confirmUrl = `${site}/api/waitlist/confirm?token=${encodeURIComponent(options.token)}`
  const unsubscribeUrl = `${site}/api/waitlist/unsubscribe?token=${encodeURIComponent(options.token)}`

  const intlLine =
    options.isInternational === true
      ? `<p style="margin:16px 0;font-size:15px;line-height:1.6;color:#334155">We built the international candidate features specifically for people like you. We can't wait to show you what we've built.</p>`
      : ""

  const html = `
<!DOCTYPE html>
<html>
<body style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0f172a">
  <p style="font-size:17px;font-weight:600;margin:0 0 12px">You're on the Hireoven waitlist</p>
  <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155">Thanks for joining. Hireoven monitors thousands of company career pages in real time so you can apply before the crowd.</p>
  ${intlLine}
  <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155">We're launching soon - you'll be among the first to know.</p>
  <p style="margin:24px 0">
    <a href="${confirmUrl}" style="display:inline-block;background:#1D9E75;color:#fff;text-decoration:none;padding:12px 20px;border-radius:12px;font-weight:600;font-size:15px">Confirm your email</a>
  </p>
  <p style="font-size:13px;line-height:1.5;color:#64748b">
    <a href="${unsubscribeUrl}" style="color:#64748b">Unsubscribe</a> · You signed up at hireoven.com/launch
  </p>
</body>
</html>`

  const text = [
    "You're on the Hireoven waitlist",
    "",
    "Thanks for joining. Hireoven monitors thousands of company career pages in real time so you can apply before the crowd.",
    options.isInternational === true
      ? "We built the international candidate features specifically for people like you. We can't wait to show you what we've built."
      : "",
    "",
    "We're launching soon - you'll be among the first to know.",
    "",
    `Confirm your email: ${confirmUrl}`,
    "",
    `Unsubscribe: ${unsubscribeUrl}`,
    "",
    "You signed up at hireoven.com/launch",
  ]
    .filter(Boolean)
    .join("\n")

  const { error } = await resend.emails.send({
    from,
    to: options.email,
    subject: "You're on the Hireoven waitlist",
    html,
    text,
  })

  if (error) {
    console.error("[waitlist] Resend error", error)
    return { ok: false as const, error: error.message }
  }

  return { ok: true as const }
}
