/**
 * Send the "we're live" announcement to waitlist members who have not
 * created an account yet.
 *
 * Usage:
 *   npx tsx scripts/send-launch-announcement.ts             # dry run: shows who would receive it
 *   npx tsx scripts/send-launch-announcement.ts --test you@example.com   # send one test email
 *   npx tsx scripts/send-launch-announcement.ts --send      # send to everyone eligible
 *   npx tsx scripts/send-launch-announcement.ts --send --limit 50        # send to first 50 only
 *
 * Eligible = on waitlist, not unsubscribed, and no account in auth.users yet.
 */
import { Resend } from "resend"
import { getPostgresPool } from "@/lib/postgres/server"
import { getWaitlistFromEmail } from "@/lib/email/identity"
import { getPublicSiteUrl } from "@/lib/waitlist/site-url"

const SUBJECT = "HireOven is live. Your spot is ready."
const DELAY_MS = 650 // stay under Resend rate limits

function buildHtml(unsubscribeUrl: string, site: string) {
  return `<!DOCTYPE html>
<html>
<body style="margin:0;background:#f8fafc;padding:24px;font-family:Inter,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#0f172a">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden">
    <tr>
      <td style="padding:28px 28px 8px 28px">
        <p style="margin:0;font-size:13px;letter-spacing:.08em;text-transform:uppercase;font-weight:700;color:#FF5C18">Hireoven</p>
        <h1 style="margin:10px 0 0 0;font-size:24px;line-height:1.3;color:#0f172a">The doors are open. You're in.</h1>
      </td>
    </tr>
    <tr>
      <td style="padding:14px 28px 0 28px">
        <p style="margin:0;font-size:15px;line-height:1.7;color:#334155">
          You joined the Hireoven waitlist, and today we launched. No more invites, no more waiting:
          your account is one click away.
        </p>
        <p style="margin:14px 0 0 0;font-size:15px;line-height:1.7;color:#334155">
          Every job on Hireoven is pulled from company career pages minutes after it posts,
          checked for H-1B sponsorship against DOL and USCIS records, and scored against your
          profile. Apex, our AI copilot, tailors your resume and fills applications for you.
        </p>
      </td>
    </tr>
    <tr>
      <td style="padding:24px 28px">
        <a href="${site}/signup" style="display:inline-block;background:linear-gradient(135deg,#FF5C18,#FF7A35);background-color:#FF5C18;color:#ffffff;text-decoration:none;padding:13px 24px;border-radius:10px;font-weight:700;font-size:15px">Create your free account</a>
        <p style="margin:12px 0 0 0;font-size:13.5px;line-height:1.6;color:#64748b">
          Takes under a minute. You can sign up with Google, or use your email and a password.
          If you already created an account, you're all set:
          <a href="${site}/login" style="color:#FF5C18;font-weight:600">sign in here</a>.
        </p>
      </td>
    </tr>
    <tr>
      <td style="padding:0 28px 24px 28px">
        <p style="margin:0;font-size:13px;line-height:1.6;color:#64748b">
          Thank you for waiting with us. Fresh jobs are in the oven.
        </p>
        <p style="margin:12px 0 0 0;font-size:12.5px;line-height:1.6;color:#94a3b8">
          <a href="${unsubscribeUrl}" style="color:#94a3b8">Unsubscribe</a> · You received this because you joined the waitlist at hireoven.com
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`
}

function buildText(unsubscribeUrl: string, site: string) {
  return [
    "Hireoven is live. Your spot is ready.",
    "",
    "You joined the Hireoven waitlist, and today we launched.",
    "No more invites, no more waiting: your account is one click away.",
    "",
    "Every job on Hireoven is pulled from company career pages minutes after it posts,",
    "checked for H-1B sponsorship against DOL and USCIS records, and scored against your profile.",
    "Apex, our AI copilot, tailors your resume and fills applications for you.",
    "",
    `Create your free account (email or Google sign-in): ${site}/signup`,
    `Already have an account? Sign in: ${site}/login`,
    "",
    `Unsubscribe: ${unsubscribeUrl}`,
  ].join("\n")
}

async function main() {
  const args = process.argv.slice(2)
  const send = args.includes("--send")
  const testIdx = args.indexOf("--test")
  const testEmail = testIdx >= 0 ? args[testIdx + 1] : null
  const limitIdx = args.indexOf("--limit")
  const limit = limitIdx >= 0 ? Number(args[limitIdx + 1]) : null

  const apiKey = process.env.RESEND_API_KEY
  if ((send || testEmail) && !apiKey) {
    console.error("RESEND_API_KEY is not set. Aborting.")
    process.exit(1)
  }
  const resend = apiKey ? new Resend(apiKey) : null
  const from = getWaitlistFromEmail()
  const site = getPublicSiteUrl()

  if (testEmail) {
    const unsubscribeUrl = `${site}/api/waitlist/unsubscribe?token=test`
    const { error } = await resend!.emails.send({
      from, to: testEmail, subject: SUBJECT,
      html: buildHtml(unsubscribeUrl, site),
      text: buildText(unsubscribeUrl, site),
    })
    console.log(error ? `Test send failed: ${error.message}` : `Test email sent to ${testEmail}`)
    return
  }

  const pool = getPostgresPool()
  const { rows } = await pool.query<{ email: string; confirmation_token: string | null }>(
    `SELECT w.email, w.confirmation_token
     FROM waitlist w
     WHERE w.unsubscribed_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM auth.users u WHERE LOWER(u.email) = LOWER(w.email)
       )
     ORDER BY w.joined_at ASC
     ${limit ? `LIMIT ${limit}` : ""}`
  )

  console.log(`Eligible recipients (waitlist, not unsubscribed, no account yet): ${rows.length}`)
  if (!send) {
    console.log("Dry run. First 10:")
    rows.slice(0, 10).forEach((r) => console.log("  " + r.email))
    console.log("\nRun with --test you@example.com to preview, then --send to deliver.")
    process.exit(0)
  }

  let sent = 0, failed = 0
  for (const row of rows) {
    const unsubscribeUrl = `${site}/api/waitlist/unsubscribe?token=${encodeURIComponent(row.confirmation_token ?? "")}`
    const { error } = await resend!.emails.send({
      from, to: row.email, subject: SUBJECT,
      html: buildHtml(unsubscribeUrl, site),
      text: buildText(unsubscribeUrl, site),
    })
    if (error) { failed++; console.error(`FAIL ${row.email}: ${error.message}`) }
    else { sent++; if (sent % 25 === 0) console.log(`...${sent} sent`) }
    await new Promise((r) => setTimeout(r, DELAY_MS))
  }
  console.log(`Done. Sent: ${sent}, failed: ${failed}`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
