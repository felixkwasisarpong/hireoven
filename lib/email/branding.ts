/**
 * Email branding helpers — produces absolute URLs for the Hireoven logo and
 * company logos that work inside HTML emails. Relative paths break in most
 * mail clients (no base URL context), so anything served from /public has
 * to be absolutified to the production origin.
 */
import { companyLogoUrlFromDomain } from "@/lib/companies/logo-url"

/** Absolute origin for any /public asset referenced in an email body. */
function getEmailBaseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "https://hireoven.com"
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
      : "/brand/hireoven-logo-header-transparent.png"
  return `${base}${path}`
}

/**
 * Returns the Hireoven job-detail URL for an email link target. We route
 * email + push notifications through the in-app detail page (not the raw
 * apply_url) so users land in the Hireoven workspace where Scout, match
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
