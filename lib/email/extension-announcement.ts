/**
 * Standalone announcement email for the Hireoven Apex Bridge Chrome extension
 * launch. Used by `scripts/send-extension-announcement.ts` for one-off sends.
 */
import { Resend } from "resend"
import { logApiUsage } from "@/lib/admin/usage"
import { getHireovenEmailLogoUrl } from "@/lib/email/branding"
import { getAlertsFromEmail } from "@/lib/email/identity"

const CHROME_STORE_URL =
  "https://chromewebstore.google.com/detail/hireoven-apex-bridge/mkmfffcaimjnaecoelnanifookmdbfok"

function getBaseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "https://hireoven.com"
}

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

export function renderExtensionAnnouncementHtml(opts: {
  recipientName?: string | null
  recipientEmail: string
}): { html: string; subject: string; preheader: string } {
  const { recipientName, recipientEmail } = opts
  const base = getBaseUrl()
  const greeting = recipientName ? `Hey ${recipientName.split(/\s+/)[0]},` : "Hey there,"
  const year = new Date().getFullYear()
  const subject = "New: a match score on every job posting (free Chrome extension)"
  const preheader =
    "Hireoven Apex Bridge overlays match scores, missing-skills analysis, and one-click autofill on Greenhouse, Lever, Ashby, Workday, iCIMS, and more."
  const extensionUrl = `${base}/extension`
  const apexAnalysisImg = `${base}/extension/apex-analysis.png`
  const autofillImg = `${base}/extension/autofill-drawer.png`

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#f3f2ef;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">

  <div style="display:none;max-height:0;overflow:hidden;font-size:1px;color:#f3f2ef;">${esc(preheader)}</div>

  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f2ef;padding:24px 16px 0;">
    <tr><td align="center">
      <table width="100%" style="max-width:584px;" cellpadding="0" cellspacing="0">

        <!-- Wordmark header -->
        <tr><td style="padding:0 0 16px;">
          <img src="${getHireovenEmailLogoUrl("wordmark")}" alt="Hireoven" height="28"
               style="display:block;height:28px;width:auto;border:0;outline:none;text-decoration:none;" />
        </td></tr>

        <!-- Hero card -->
        <tr><td style="background:linear-gradient(160deg,#0C0A1E 0%,#16102e 50%,#1a0a2e 100%);border-radius:12px;overflow:hidden;border:1px solid #1f1733;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="padding:30px 28px 8px;">
              <div style="font-size:11px;font-weight:700;letter-spacing:0.18em;color:#FF9A3C;text-transform:uppercase;">
                New · Chrome Web Store
              </div>
              <div style="font-size:28px;font-weight:900;color:#ffffff;line-height:1.15;margin-top:10px;letter-spacing:-0.01em;">
                A match score on
                <span style="color:#FF9A3C;">every job posting.</span>
              </div>
              <div style="font-size:15px;color:rgba(255,255,255,0.65);line-height:1.6;margin-top:14px;">
                Hireoven Apex Bridge is live. It overlays your match score, missing-skills callouts, and one-click autofill on the ATS pages you&rsquo;re already on — Greenhouse, Lever, Ashby, Workday, iCIMS, and more.
              </div>
            </td></tr>

            <tr><td style="padding:20px 28px 8px;">
              <a href="${esc(CHROME_STORE_URL)}"
                 style="display:inline-block;background:linear-gradient(135deg,#FF5C18,#FF7A35);color:#ffffff;text-decoration:none;padding:13px 26px;border-radius:14px;font-size:14px;font-weight:700;box-shadow:0 10px 28px -12px rgba(255,92,24,0.55);">
                Add to Chrome — free
              </a>
              <a href="${esc(extensionUrl)}"
                 style="display:inline-block;color:rgba(255,255,255,0.75);text-decoration:none;padding:13px 18px;font-size:13.5px;font-weight:600;">
                Learn more →
              </a>
            </td></tr>

            <tr><td style="padding:18px 28px 28px;">
              <img src="${apexAnalysisImg}" alt="Apex analysis overlay on a Greenhouse posting"
                   width="528" style="display:block;width:100%;max-width:528px;height:auto;border-radius:10px;border:1px solid rgba(255,255,255,0.08);" />
            </td></tr>
          </table>
        </td></tr>

        <!-- Body card -->
        <tr><td style="background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e2e8f0;margin-top:16px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="padding:24px 28px 4px;">
              <div style="font-size:15px;color:#0f172a;line-height:1.65;">
                ${esc(greeting)}
              </div>
              <div style="font-size:14.5px;color:#334155;line-height:1.7;margin-top:14px;">
                We just shipped the <strong>Hireoven Apex Bridge</strong> on the Chrome Web Store. It&rsquo;s the workspace that lives <em>where you actually apply</em> — overlaid on every ATS page, ready in one click.
              </div>
            </td></tr>

            <tr><td style="padding:20px 28px 6px;">
              <div style="font-size:13px;font-weight:800;color:#0f172a;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:14px;">What you get</div>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr><td style="padding:8px 0;border-top:1px solid #f1f5f9;">
                  <div style="font-size:14px;font-weight:700;color:#0f172a;">🎯&nbsp;&nbsp;Instant match score</div>
                  <div style="font-size:13px;color:#64748b;line-height:1.6;margin-top:3px;">See your fit against the JD before reading the requirements.</div>
                </td></tr>
                <tr><td style="padding:8px 0;border-top:1px solid #f1f5f9;">
                  <div style="font-size:14px;font-weight:700;color:#0f172a;">🔍&nbsp;&nbsp;Missing-skills callouts</div>
                  <div style="font-size:13px;color:#64748b;line-height:1.6;margin-top:3px;">Know whether to apply, tailor, or skip — backed by the JD text.</div>
                </td></tr>
                <tr><td style="padding:8px 0;border-top:1px solid #f1f5f9;">
                  <div style="font-size:14px;font-weight:700;color:#0f172a;">🪄&nbsp;&nbsp;One-click autofill</div>
                  <div style="font-size:13px;color:#64748b;line-height:1.6;margin-top:3px;">Field-by-field detection with a review pass. Never auto-submits.</div>
                </td></tr>
                <tr><td style="padding:8px 0;border-top:1px solid #f1f5f9;">
                  <div style="font-size:14px;font-weight:700;color:#0f172a;">✍️&nbsp;&nbsp;Resume tailoring on the spot</div>
                  <div style="font-size:13px;color:#64748b;line-height:1.6;margin-top:3px;">Open Apex, tailor your resume to the JD, attach it — without leaving the page.</div>
                </td></tr>
                <tr><td style="padding:8px 0;border-top:1px solid #f1f5f9;border-bottom:1px solid #f1f5f9;">
                  <div style="font-size:14px;font-weight:700;color:#0f172a;">🛡️&nbsp;&nbsp;You&rsquo;re always in control</div>
                  <div style="font-size:13px;color:#64748b;line-height:1.6;margin-top:3px;">Every fill, every save, every action requires your explicit OK.</div>
                </td></tr>
              </table>
            </td></tr>

            <tr><td style="padding:6px 28px 22px;">
              <img src="${autofillImg}" alt="Autofill drawer listing every field with status"
                   width="528" style="display:block;width:100%;max-width:528px;height:auto;border-radius:10px;border:1px solid #e2e8f0;" />
              <div style="font-size:12px;color:#94a3b8;text-align:center;margin-top:8px;">
                The autofill drawer: every field labelled <strong>WILL FILL</strong>, <strong>NEEDS REVIEW</strong>, or <strong>REVIEW BELOW</strong> before you confirm.
              </div>
            </td></tr>

            <tr><td style="padding:8px 28px 28px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr><td>
                  <a href="${esc(CHROME_STORE_URL)}"
                     style="display:inline-block;background:linear-gradient(135deg,#FF5C18,#FF7A35);color:#ffffff;text-decoration:none;padding:13px 28px;border-radius:14px;font-size:14px;font-weight:700;">
                    Install for Chrome
                  </a>
                </td><td style="padding-left:8px;">
                  <a href="${esc(extensionUrl)}"
                     style="display:inline-block;border:1.5px solid #e2e8f0;color:#334155;text-decoration:none;padding:11.5px 22px;border-radius:14px;font-size:13.5px;font-weight:700;">
                    Tour the page
                  </a>
                </td></tr>
              </table>
              <div style="font-size:12px;color:#94a3b8;margin-top:14px;">
                Works on Chrome, Edge, Brave &amp; Arc. Free with any Hireoven account.
              </div>
            </td></tr>
          </table>
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:20px 4px 32px;">
          <div style="font-size:12px;color:#64748b;line-height:1.7;">
            Sent to <strong>${esc(recipientEmail)}</strong> because you&rsquo;re part of the Hireoven community.<br>
            <a href="${esc(base)}/dashboard/settings" style="color:#64748b;text-decoration:underline;">Manage emails</a>
            &nbsp;&middot;&nbsp;
            <a href="${esc(base)}" style="color:#64748b;text-decoration:underline;">Open Hireoven</a>
            &nbsp;&middot;&nbsp;
            <a href="${esc(base)}/support" style="color:#64748b;text-decoration:underline;">Help</a>
          </div>
          <div style="margin-top:12px;">
            <img src="${getHireovenEmailLogoUrl("wordmark")}" alt="Hireoven" height="20"
                 style="display:block;height:20px;width:auto;border:0;outline:none;text-decoration:none;" />
          </div>
          <div style="font-size:11px;color:#94a3b8;margin-top:6px;">
            &copy; ${year} Hireoven. Jobs served fresh.
          </div>
        </td></tr>

      </table>
    </td></tr>
  </table>

</body>
</html>`

  return { html, subject, preheader }
}

export async function sendExtensionAnnouncement(opts: {
  to: string
  recipientName?: string | null
}): Promise<{ id: string }> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not set — add it to .env.local before sending.")
  }
  const resend = new Resend(apiKey)
  const { html, subject } = renderExtensionAnnouncementHtml({
    recipientEmail: opts.to,
    recipientName: opts.recipientName ?? null,
  })

  const result = await resend.emails.send({
    from: getAlertsFromEmail(),
    to: opts.to,
    subject,
    html,
  })

  if (result.error) {
    throw new Error(`Resend rejected the send: ${result.error.message}`)
  }
  const id = result.data?.id ?? "unknown"
  try {
    await logApiUsage({
      service: "resend",
      operation: "extension_announcement",
      tokens_used: null,
      cost_usd: null,
    })
  } catch {
    // logging is best-effort; don't fail the send if it errors.
  }
  return { id }
}
