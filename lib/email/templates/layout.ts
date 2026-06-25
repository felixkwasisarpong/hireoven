// Spec 08 — shared email chrome. Raw HTML strings (matches the existing email code,
// no React Email dep), table-based + inline styles for Gmail/Outlook/Apple Mail.
// No logo image (image loading drops deliverability) and no tracking pixel (Apple
// MPP makes open rates a lie). Every email carries a CAN-SPAM physical address and
// both unsubscribe surfaces.

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://hireoven.com").replace(/\/$/, "")
// CAN-SPAM requires a valid physical postal address in every email.
const PHYSICAL_ADDRESS = process.env.MAIL_PHYSICAL_ADDRESS ?? "Hireoven, 3130 4th St, Lubbock, TX 79415"

export function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

export function unsubscribeUrl(token: string): string {
  return `${APP_URL}/unsubscribe?token=${token}`
}

// RFC 8058 List-Unsubscribe target — must accept POST (mail clients one-click POST
// here). The visible footer uses unsubscribeUrl() (a page); this is for the header.
export function unsubscribePostUrl(token: string): string {
  return `${APP_URL}/api/email/unsubscribe?token=${token}`
}

export function preferencesUrl(): string {
  return `${APP_URL}/dashboard/email-preferences`
}

export function appUrl(path = ""): string {
  return `${APP_URL}${path}`
}

interface LayoutInput {
  preheader: string
  bodyHtml: string
  unsubscribeUrl: string
  unsubscribeLabel?: string
}

export function renderLayout({ preheader, bodyHtml, unsubscribeUrl, unsubscribeLabel }: LayoutInput): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
<span style="display:none!important;opacity:0;color:#f4f6f9;height:0;overflow:hidden;">${esc(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;"><tr><td align="center" style="padding:28px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e6e9ee;border-radius:14px;">
  <tr><td style="padding:22px 28px 0;">
    <span style="font-size:18px;font-weight:800;letter-spacing:-0.01em;color:#0f172a;">Hireoven</span>
  </td></tr>
  <tr><td style="padding:14px 28px 24px;">${bodyHtml}</td></tr>
  <tr><td style="padding:0 28px 22px;">
    <hr style="border:none;border-top:1px solid #eef1f5;margin:8px 0 14px;">
    <p style="margin:0 0 6px;font-size:12px;line-height:1.5;color:#94a3b8;">
      ${esc(PHYSICAL_ADDRESS)}
    </p>
    <p style="margin:0;font-size:12px;line-height:1.5;color:#94a3b8;">
      <a href="${unsubscribeUrl}" style="color:#64748b;text-decoration:underline;">${esc(unsubscribeLabel ?? "Unsubscribe")}</a>
      &nbsp;·&nbsp;
      <a href="${preferencesUrl()}" style="color:#64748b;text-decoration:underline;">Email preferences</a>
    </p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`
}

// Plain-text footer appended to every text body (CAN-SPAM + unsubscribe).
export function textFooter(unsub: string): string {
  return `\n\n—\n${PHYSICAL_ADDRESS}\nUnsubscribe: ${unsub}\nEmail preferences: ${preferencesUrl()}`
}

// A simple CTA button (table-based for Outlook).
export function ctaButton(label: string, href: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:18px 0 4px;"><tr><td style="border-radius:10px;background:#FF5C18;">
    <a href="${href}" style="display:inline-block;padding:11px 20px;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;">${esc(label)}</a>
  </td></tr></table>`
}
