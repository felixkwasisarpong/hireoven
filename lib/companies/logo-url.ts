/**
 * Default company logo image URLs derived from email-style domain (e.g. stripe.com).
 * Used to backfill companies.logo_url when you don't store your own assets.
 */

export type LogoProvider =
  | "clearbit"
  | "unavatar"
  | "duckduckgo"
  | "google-favicon"

export function normalizeCompanyDomain(domain: string) {
  return domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]!
}

/**
 * Public logo URL for img[src] — no API key for these providers.
 * - clearbit: high-quality brand marks when available (project already allows logo.clearbit.com in next.config).
 * - unavatar: aggregates favicons / avatars; good fallback.
 * - google-favicon: always returns something small (128px).
 */
export function companyLogoUrlFromDomain(
  domain: string,
  provider: LogoProvider = "google-favicon"
): string {
  const d = normalizeCompanyDomain(domain)
  if (!d) return ""

  switch (provider) {
    case "clearbit":
      return `https://logo.clearbit.com/${encodeURIComponent(d)}`
    case "unavatar":
      return `https://unavatar.io/${encodeURIComponent(d)}`
    case "duckduckgo":
      return `https://icons.duckduckgo.com/ip3/${encodeURIComponent(d)}.ico`
    case "google-favicon":
      return `https://www.google.com/s2/favicons?sz=128&domain=${encodeURIComponent(d)}`
    default:
      return `https://www.google.com/s2/favicons?sz=128&domain=${encodeURIComponent(d)}`
  }
}
