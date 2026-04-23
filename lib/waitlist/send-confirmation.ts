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
      ? `<p style="margin:16px 0;font-size:15px;line-height:1.7;color:#334155">We also built international job-seeker workflows for visa-aware applications, sponsorship insights, and faster prioritization.</p>`
      : ""

  const html = `
<!DOCTYPE html>
<html>
<body style="margin:0;background:#f8fafc;padding:24px;font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden">
    <tr>
      <td style="padding:24px 24px 8px 24px">
        <p style="margin:0;font-size:13px;letter-spacing:.08em;text-transform:uppercase;font-weight:700;color:#0369a1">Hireoven</p>
        <h1 style="margin:8px 0 0 0;font-size:22px;line-height:1.3;color:#0f172a">Welcome - please confirm your email</h1>
      </td>
    </tr>
    <tr>
      <td style="padding:12px 24px 0 24px">
        <p style="margin:0;font-size:15px;line-height:1.7;color:#334155">Thank you for joining the Hireoven waitlist. We monitor company career pages in near real time so you can discover and apply to fresh opportunities earlier.</p>
      </td>
    </tr>
    <tr>
      <td style="padding:0 24px">
  ${intlLine}
      </td>
    </tr>
    <tr>
      <td style="padding:8px 24px 0 24px">
        <p style="margin:0;font-size:15px;line-height:1.7;color:#334155">We are launching soon, and you will be among the first to receive access updates.</p>
      </td>
    </tr>
    <tr>
      <td style="padding:24px">
        <a href="${confirmUrl}" style="display:inline-block;background:#0f766e;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600;font-size:15px">Confirm email address</a>
      </td>
    </tr>
    <tr>
      <td style="padding:0 24px 24px 24px">
        <p style="margin:0;font-size:13px;line-height:1.6;color:#64748b">If you did not request this, you can safely ignore this email.</p>
        <p style="margin:10px 0 0 0;font-size:13px;line-height:1.6;color:#64748b"><a href="${unsubscribeUrl}" style="color:#64748b">Unsubscribe</a> · Submitted via hireoven.com/launch</p>
      </td>
    </tr>
  </table>
</body>
</html>`

  const text = [
    "Welcome to Hireoven - Please confirm your email",
    "",
    "Thank you for joining the Hireoven waitlist.",
    "Hireoven monitors company career pages in near real time so you can discover and apply to fresh opportunities earlier.",
    options.isInternational === true
      ? "We also built international job-seeker workflows for visa-aware applications and sponsorship insights."
      : "",
    "",
    "We're launching soon, and you'll be among the first to receive access updates.",
    "",
    `Confirm your email address: ${confirmUrl}`,
    "",
    `Unsubscribe: ${unsubscribeUrl}`,
    "",
    "Submitted via hireoven.com/launch",
  ]
    .filter(Boolean)
    .join("\n")

  const { error } = await resend.emails.send({
    from,
    to: options.email,
    subject: "Welcome to Hireoven - confirm your email",
    html,
    text,
  })

  if (error) {
    console.error("[waitlist] Resend error", error)
    return { ok: false as const, error: error.message }
  }

  return { ok: true as const }
}
