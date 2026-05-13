import { companyLogoUrlFromDomain } from "@/lib/companies/logo-url"

const PLACEHOLDER_DOMAIN_RE = /\.placeholder$/i

/**
 * When a job comes from an aggregator like Dice and the company row was
 * created as a placeholder (synthetic `*.placeholder` domain, no logo), we
 * have no real brand mark to show — the card would otherwise render a
 * generic single-letter chip. Fall back to the source's own logo so users
 * at least know where the listing came from.
 *
 * Only returns a fallback when *both* signals say the company is a
 * placeholder; returns null when a real domain + logo are available so we
 * don't override good company branding.
 */
export type JobLogoSourceFields = {
  apply_url?: string | null
}

export function jobSourceFallbackLogo(
  job: JobLogoSourceFields,
  companyDomain: string | null | undefined,
  companyLogoUrl: string | null | undefined
): { logoUrl: string; domain: string } | null {
  const applyUrl = (job.apply_url ?? "").toLowerCase()
  const placeholderDomain = !!companyDomain && PLACEHOLDER_DOMAIN_RE.test(companyDomain)
  const noLogo = !companyLogoUrl?.trim()
  if (!placeholderDomain || !noLogo) return null

  if (applyUrl.includes("dice.com")) {
    return { logoUrl: companyLogoUrlFromDomain("dice.com"), domain: "dice.com" }
  }
  return null
}
