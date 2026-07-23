/**
 * Email branding helpers — produces absolute URLs for the Hireoven logo and
 * company logos that work inside HTML emails. Relative paths break in most
 * mail clients (no base URL context), so anything served from /public has
 * to be absolutified to the production origin.
 */
import { companyLogoUrlFromDomain } from "@/lib/companies/logo-url"

/** Absolute origin for any /public asset referenced in an email body. */
export function getEmailBaseUrl(): string {
  // `??` only catches undefined/null — if NEXT_PUBLIC_APP_URL is the
  // empty string or a relative path (misconfigured env), the previous
  // version returned that value and produced broken /brand/... links in
  // the email body. Validate that we have an absolute http(s) origin
  // before using it. Localhost is also unusable once a real email leaves
  // the machine, so fall back to the public hostname for local origins.
  const raw = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "").trim()
  if (!raw || !/^https?:\/\//i.test(raw)) return "https://hireoven.com"

  try {
    const url = new URL(raw)
    const localHosts = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"])
    return localHosts.has(url.hostname) ? "https://hireoven.com" : raw
  } catch {
    return "https://hireoven.com"
  }
}

/**
 * Returns an absolute URL for the Hireoven logo image suitable for use in
 * the <img src> of an email header. Tries the wordmark first (works on
 * white backgrounds); accepts a `variant` override for dark headers.
 */
export function getHireovenEmailLogoUrl(variant: "wordmark" | "icon" = "wordmark"): string {
  const base = getEmailBaseUrl()
  const path =
    variant === "icon"
      ? "/brand/hireoven-icon-256.png"
      : "/brand/hireoven-wordmark-transparent.png"
  return `${base}${path}`
}

/** Canonical Chrome Web Store URL for the Hireoven Apex Bridge extension. */
const CHROME_STORE_URL =
  "https://chromewebstore.google.com/detail/hireoven-apex-bridge/mkmfffcaimjnaecoelnanifookmdbfok"

/**
 * Light, tasteful Chrome-extension promo block rendered just above the
 * unsubscribe footer in notification emails.
 *
 * Inline-styled tables — no flex, no max-width media queries, no SVG —
 * so it renders consistently across Gmail / Outlook / Apple Mail / mobile.
 */
export function renderEmailExtensionFooter(): string {
  const base = getEmailBaseUrl()
  const learnMoreUrl = `${base}/extension`
  const favicon = `${base}/brand/hireoven-favicon-64.png`
  return `
        <tr><td style="padding:0 32px 24px;">
          <table width="100%" cellpadding="0" cellspacing="0"
                 style="background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;">
            <tr>
              <td style="padding:18px 20px;vertical-align:middle;width:56px;">
                <img src="${favicon}" alt="Hireoven" width="40" height="40"
                     style="display:block;width:40px;height:40px;border-radius:10px;border:0;outline:none;text-decoration:none;" />
              </td>
              <td style="padding:18px 8px 18px 0;vertical-align:middle;">
                <div style="font-size:11px;font-weight:700;letter-spacing:0.12em;color:#FF6B1A;text-transform:uppercase;">
                  Chrome extension
                </div>
                <div style="font-size:14px;font-weight:600;color:#0f172a;line-height:1.4;margin-top:3px;">
                  See your match score on every LinkedIn, Indeed &amp; ATS job.
                </div>
                <div style="font-size:12px;color:#64748b;line-height:1.5;margin-top:2px;">
                  Autofill applications, save in one click.
                  <a href="${learnMoreUrl}" style="color:#0369A1;text-decoration:none;font-weight:600;">Learn more</a>
                </div>
              </td>
              <td style="padding:18px 20px;vertical-align:middle;text-align:right;white-space:nowrap;">
                <a href="${CHROME_STORE_URL}"
                   style="display:inline-block;background:#0369A1;color:#ffffff;text-decoration:none;padding:9px 14px;border-radius:8px;font-size:12.5px;font-weight:700;">
                  Add to Chrome
                </a>
              </td>
            </tr>
          </table>
        </td></tr>`
}

/**
 * Returns the Hireoven job-detail URL for an email link target. We route
 * email + push notifications through the in-app detail page (not the raw
 * apply_url) so users land in the Hireoven workspace where Apex, match
 * scores, and save/apply controls live.
 */
export function getHireovenJobDetailUrl(jobId: string): string {
  return `${getEmailBaseUrl()}/dashboard/jobs/${jobId}`
}

/**
 * Returns an absolute URL for a company's logo, suitable for email use.
 * Prefers an explicit `logo_url` if it's already absolute; otherwise falls
 * back to companyLogoUrlFromDomain() (logo.dev / favicon / static). Always
 * returns an absolute URL or "" when we have nothing.
 */
export function getEmailCompanyLogoUrl(
  domain: string | null | undefined,
  logoUrl: string | null | undefined,
): string {
  const base = getEmailBaseUrl()

  // 1) explicit logo_url already on the company row — preferred when absolute
  if (logoUrl) {
    const trimmed = logoUrl.trim()
    if (/^https?:\/\//i.test(trimmed)) return trimmed
    if (trimmed.startsWith("/")) return `${base}${trimmed}`
  }

  // 2) derived from domain via logo-dev / favicon / static
  if (domain) {
    const derived = companyLogoUrlFromDomain(domain)
    if (derived) {
      if (/^https?:\/\//i.test(derived)) return derived
      if (derived.startsWith("/")) return `${base}${derived}`
    }
  }

  return ""
}
