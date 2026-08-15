import { isAtsDomain } from "@/lib/companies/ats-domains"
import { resolveAppOrigin } from "@/lib/app-url"

/**
 * Default company logo image URLs derived from email-style domain (e.g. stripe.com).
 * Used to backfill companies.logo_url when you don't store your own assets.
 */

/**
 * Absolute form of a stored logo_url, for renderers that reject relative
 * paths — the @vercel/og image renderer throws "Image source must be an
 * absolute URL" on local /company-logos/* assets, killing the whole OG
 * response. Pass the incoming request when available so the origin matches
 * the host actually being served (falls back to the validated env origin).
 */
export function absoluteLogoUrl(
  logoUrl: string | null | undefined,
  request?: Request
): string | null {
  const url = logoUrl?.trim()
  if (!url) return null
  return url.startsWith("/") ? `${resolveAppOrigin(request)}${url}` : url
}

/**
 * Returns true when the stored `logo_url` value is safe to use as-is:
 * - Non-empty string
 * - Not an ATS-domain favicon (e.g. logo.clearbit.com/greenhouse.io)
 * - Not a known placeholder pattern (USCIS-style .uscis-employer domains in Clearbit paths)
 * - Local /company-logos/ paths are always safe
 *
 * Use this before deciding whether to overwrite the stored logo_url.
 */
export function isLogoUrlSafe(logoUrl: string | null | undefined): boolean {
  if (!logoUrl?.trim()) return false
  const url = logoUrl.trim()

  // Local static assets are always safe
  if (url.startsWith("/company-logos/")) return true
  if (url.startsWith("/")) return true

  try {
    const u = new URL(url)

    // Clearbit: reject when the path domain is an ATS domain or placeholder
    if (u.hostname === "logo.clearbit.com") {
      const pathDomain = u.pathname.replace(/^\/+/, "").split("/")[0] ?? ""
      if (!pathDomain) return false
      if (isAtsDomain(pathDomain)) return false
      if (/\.(uscis-employer|lca-employer)$/.test(pathDomain)) return false
      return true
    }

    // logo.dev: https://img.logo.dev/{domain}?token=... — reject ATS domains
    if (u.hostname === "img.logo.dev") {
      const domainParam = u.pathname.replace(/^\/+/, "").split("?")[0] ?? ""
      if (!domainParam) return false
      if (isAtsDomain(domainParam)) return false
      return true
    }

    // Google favicon endpoints:
    // - https://www.google.com/s2/favicons?...&domain=example.com
    // - https://t3.gstatic.com/faviconV2?...&url=http://example.com
    if (u.hostname.includes("google.com") || u.hostname.endsWith(".gstatic.com")) {
      const direct = u.searchParams.get("domain") ?? u.searchParams.get("domain_url") ?? ""
      const rawUrl = u.searchParams.get("url") ?? ""
      let target = normalizeCompanyDomain(direct)
      if (!target && rawUrl.trim()) {
        try {
          const parsed = rawUrl.includes("://") ? new URL(rawUrl) : new URL(`https://${rawUrl}`)
          target = normalizeCompanyDomain(parsed.hostname)
        } catch {
          target = normalizeCompanyDomain(rawUrl)
        }
      }
      if (!target) return false
      if (isAtsDomain(target)) return false
      if (/\.(uscis-employer|lca-employer)$/.test(target)) return false
      return true
    }

    // icon.horse / unavatar / duckduckgo: reject ATS paths
    if (
      u.hostname === "icon.horse" ||
      u.hostname === "unavatar.io" ||
      u.hostname.includes("duckduckgo.com")
    ) {
      const pathDomain = u.pathname.replace(/^\/icon\/|^\//, "").split("?")[0] ?? ""
      if (isAtsDomain(pathDomain)) return false
      return true
    }

    // Any other https URL is considered safe
    return u.protocol === "https:"
  } catch {
    return false
  }
}

export type LogoProvider =
  | "logo-dev"
  | "icon-horse"
  | "clearbit"
  | "unavatar"
  | "duckduckgo"
  | "google-favicon"

function getLogoDevPublishableToken(): string {
  const candidates = [
    process.env.NEXT_PUBLIC_LOGO_DEV_TOKEN,
    process.env.LOGO_DEV_TOKEN,
  ]
  for (const raw of candidates) {
    const token = (raw ?? "").trim()
    // logo.dev board/logo URLs require publishable keys.
    if (token.startsWith("pk_")) return token
  }
  return ""
}

/**
 * Extract the domain segment from a logo.dev image URL
 * (`https://img.logo.dev/{domain}?token=...`) — recovers a company's real
 * domain when `companies.domain` has since been overwritten by an internal
 * discovery placeholder (`*-tenant`, `*.discovered`, …) but `logo_url` still
 * holds a correctly-resolved logo.dev URL from an earlier backfill pass.
 */
export function extractDomainFromLogoDevUrl(logoUrl: string | null | undefined): string | null {
  if (!logoUrl?.trim()) return null
  try {
    const u = new URL(logoUrl)
    if (u.hostname !== "img.logo.dev") return null
    const domain = u.pathname.replace(/^\/+/, "").split("?")[0]?.trim()
    return domain ? normalizeCompanyDomain(domain) : null
  } catch {
    return null
  }
}

export function normalizeCompanyDomain(domain: string) {
  return domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]!
}

const LOCAL_LOGO_URL_BY_DOMAIN: Record<string, string> = {
  // Curated marks shipped in /public so logos never depend on flaky favicon CDNs.
  "palantir.com": "/company-logos/palantir.svg",
  "capitalone.com": "/company-logos/capital-one.svg",
  "fidelity.com": "/company-logos/fidelity.png",
  "fidelityinvestments.com": "/company-logos/fidelity.png",
  "insulet.com": "/company-logos/insulet.svg",
  "planetscale.com": "/company-logos/planetscale.svg",
  "expediagroup.com": "/company-logos/expedia-group.svg",
  "unitedhealthgroup.com": "/company-logos/unitedhealth-group.svg",

  "boeing.com": "/company-logos/boeing.svg",
  "edwards.com": "/company-logos/edwards.svg",
  "toasttab.com": "/company-logos/toast.svg",
  "cockroachlabs.com": "/company-logos/cockroach-labs.svg",
  "hireitpeople.com": "/company-logos/hire-it-people.svg",
  "strategicresources.com": "/company-logos/strategic-resources.svg",
  "panasonicavionics.com": "/company-logos/panasonic-avionics.svg",
  "onemain.com": "/company-logos/onemain.svg",
  "astirit.com": "/company-logos/astir-it.svg",
  "autodesk.com": "/company-logos/autodesk.svg",
  "corning.com": "/company-logos/corning.svg",
  "ea.com": "/company-logos/electronic-arts.svg",
  "samsara.com": "/company-logos/samsara.svg",
  "paloaltonetworks.com": "/company-logos/palo-alto-networks.svg",
  "ey.com": "/company-logos/ey.svg",
  "statestreet.com": "/company-logos/state-street.svg",
  "novitiumpharma.com": "/company-logos/novitium-pharma.svg",
  "allstate.com": "/company-logos/allstate.svg",
  "cigna.com": "/company-logos/cigna.svg",
  "doordash.com": "/company-logos/doordash.svg",
  "hitachivantara.com": "/company-logos/hitachi-vantara.svg",
  "homedepot.com": "/company-logos/homedepot.svg",
  "intel.com": "/company-logos/intel.svg",
  "isolve.io": "/company-logos/isolve.svg",
  "marqeta.com": "/company-logos/marqeta.svg",
  "prisma.io": "/company-logos/prisma.svg",
  "qualcomm.com": "/company-logos/qualcomm.svg",
  "quicken.com": "/company-logos/quicken.svg",
  "twitch.tv": "/company-logos/twitch.svg",
  "westvirginiauniversity.com": "/company-logos/west-virginia-university.svg",
  "anthropic.com": "/company-logos/anthropic.svg",

  // Placeholder USCIS employer domains that should still render the same mark.
  "edwards-lifesciences-llc.uscis-employer": "/company-logos/edwards.svg",
  "onemain-general-services-corporation.uscis-employer": "/company-logos/onemain.svg",
  "panasonic-avionics-corporation.uscis-employer": "/company-logos/panasonic-avionics.svg",
  "palo-alto-networks-inc.uscis-employer": "/company-logos/palo-alto-networks.svg",
  "corning-incorporated.uscis-employer": "/company-logos/corning.svg",
  "strategic-resources-international-inc.uscis-employer": "/company-logos/strategic-resources.svg",
  "autodesk-inc.uscis-employer": "/company-logos/autodesk.svg",
  "hitachi-vantara-llc.uscis-employer": "/company-logos/hitachi-vantara.svg",
  "isolve-technology-inc.uscis-employer": "/company-logos/isolve.svg",
  "marqeta-inc.uscis-employer": "/company-logos/marqeta.svg",
  "quicken-loans-llc.uscis-employer": "/company-logos/quicken.svg",
  "west-virginia-university.uscis-employer": "/company-logos/west-virginia-university.svg",
}

const FAVICON_DOMAIN_OVERRIDES: Record<string, string> = {
  // Kroger rows arrive under a few guessed or corporate domains; logo.dev
  // resolves some of those to unrelated marks, so force the consumer brand.
  "kroger.co": "kroger.com",
  "thekroger.com": "kroger.com",
  // LCA imports sometimes compress "Amazon Web Services, Inc." to this
  // guessed domain; the actual AWS mark lives on the Amazon subdomain.
  "amazonweb.com": "aws.amazon.com",
  // career-soft.com favicon fails; its careers site host resolves.
  "career-soft.com": "career.com",
  // Brand domain for S&P Global Market Intelligence; direct domain resolves to the wrong mark.
  "spglobalmarketintelligence.com": "spglobal.com",
  // Guessed domain from the truncated name "The Childrens Hospital Of Philadel"
  // resolves to nothing; the real brand domain is chop.edu.
  "thechildrenshospitalofphiladel.com": "chop.edu",
  // Johnson & Johnson: the wrongly-stored jj.com / johnsonand.com aren't J&J;
  // the real brand mark is on jnj.com.
  "jj.com": "jnj.com",
  "johnsonand.com": "jnj.com",
  // "Nametag" (account-protection / identity verification) lives on
  // getnametag.com; the bare nametag.com is an unrelated name-badge site.
  "nametag.com": "getnametag.com",
  // Source name "Infoma Group Plc" compresses to a dead host; the real brand
  // is Informa plc (FTSE 100 events/intelligence group) at informa.com.
  "infomagroupplc.com": "informa.com",
  // Miratech (IT/software outsourcing, SmartRecruiters tenant "miratech1") is
  // miratechgroup.com; the guessed miratech.com is an unrelated industrial
  // emissions company (wrong brand mark on logo.dev).
  "miratech.com": "miratechgroup.com",
  // National Vision (optical retailer, SmartRecruiters tenant "NationalVision1")
  // — the garbled "Notional Vision" name guesses to a dead host.
  "notionalvision.com": "nationalvision.com",
  // H&M Group's corporate domain carries no brand mark; the red H&M logo lives
  // on the consumer domain hm.com.
  "hmgroup.com": "hm.com",
  // Misspelled "Adapive Insights" → Adaptive Insights (now Workday Adaptive
  // Planning); its own brand domain still resolves.
  "adapiveinsights.com": "adaptiveinsights.com",
  // "Thales USA" compresses to thales.com; the canonical brand host is
  // thalesgroup.com.
  "thales.com": "thalesgroup.com",
}

const COMPANY_NAME_LOGO_DOMAIN_OVERRIDES: Record<string, string> = {
  // Public company cards should show the consumer/corporate brand, not a
  // fallback mark from an ATS tenant or guessed host.
  "advance auto parts": "advanceautoparts.com",
  "advance auto parts inc": "advanceautoparts.com",
  "american express travel related": "americanexpress.com",
  "amazon": "amazon.com",
  "amazon web services": "aws.amazon.com",
  "amazon web services aws": "aws.amazon.com",
  "aws": "aws.amazon.com",
  "autozone": "autozone.com",
  "circle k": "circlek.com",
  "circle k stores": "circlek.com",
  "circle k stores inc": "circlek.com",
  "kroger": "kroger.com",
  "the kroger": "kroger.com",
  "the kroger co": "kroger.com",
  "macys": "macys.com",
  "macy s": "macys.com",
  "tjx": "tjx.com",
  "walmart": "walmart.com",
}

function normalizeCompanyNameForLogo(name: string | null | undefined): string {
  return (name ?? "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/\b(incorporated|inc|corporation|corp|company|co|llc|ltd|limited|plc)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
}

export function resolveLogoDomainFromCompanyName(name: string | null | undefined): string {
  const key = normalizeCompanyNameForLogo(name)
  if (!key) return ""
  return COMPANY_NAME_LOGO_DOMAIN_OVERRIDES[key] ?? ""
}

/**
 * Resolve a company domain to the domain that actually serves a usable brand
 * mark, applying the favicon overrides above. Returns the input (normalized)
 * when no override exists. Used by the logo UI to redirect guessed/wrong
 * domains to their real brand domain before fetching logos.
 */
export function resolveLogoDomainOverride(domain: string | null | undefined): string {
  const normalized = normalizeCompanyDomain(domain ?? "")
  if (!normalized) return ""
  return FAVICON_DOMAIN_OVERRIDES[normalized] ?? normalized
}

const GOOGLE_FAVICON_URL_OVERRIDES: Record<string, string> = {
  // google favicon returns 404 for comcast.com; careers subdomain resolves.
  "comcast.com": "https://www.google.com/s2/favicons?sz=128&domain=jobs.comcast.com",
}

/**
 * Public logo URL for img[src].
 * Default is logo.dev (real brand marks) when LOGO_DEV_TOKEN is configured;
 * gracefully falls back to a Google favicon URL when the token is missing.
 * Other providers remain available by explicit opt-in.
 */
export function companyLogoUrlFromDomain(
  domain: string,
  provider: LogoProvider = "logo-dev"
): string {
  const normalized = normalizeCompanyDomain(domain)
  if (!normalized || isAtsDomain(normalized)) return ""
  const localLogo = LOCAL_LOGO_URL_BY_DOMAIN[normalized]
  if (localLogo) return localLogo

  const providerOverride =
    provider === "google-favicon"
      ? GOOGLE_FAVICON_URL_OVERRIDES[normalized]
      : undefined
  if (providerOverride) return providerOverride

  const d = FAVICON_DOMAIN_OVERRIDES[normalized] ?? normalized
  if (!d) return ""

  switch (provider) {
    case "logo-dev": {
      const token = getLogoDevPublishableToken()
      if (token) {
        return `https://img.logo.dev/${encodeURIComponent(d)}?token=${encodeURIComponent(token)}&size=256&format=png`
      }
      return `https://www.google.com/s2/favicons?sz=128&domain=${encodeURIComponent(d)}`
    }
    case "icon-horse":
      return `https://icon.horse/icon/${encodeURIComponent(d)}`
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
