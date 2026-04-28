import { isAtsDomain } from "@/lib/companies/ats-domains"

/**
 * Default company logo image URLs derived from email-style domain (e.g. stripe.com).
 * Used to backfill companies.logo_url when you don't store your own assets.
 */

export type LogoProvider =
  | "logo-dev"
  | "icon-horse"
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

const LOCAL_LOGO_URL_BY_DOMAIN: Record<string, string> = {
  // Curated marks shipped in /public so logos never depend on flaky favicon CDNs.
  "palantir.com": "/company-logos/palantir.svg",
  "capitalone.com": "/company-logos/capital-one.svg",
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
  "macys.com": "/company-logos/macys.svg",
  "marqeta.com": "/company-logos/marqeta.svg",
  "prisma.io": "/company-logos/prisma.svg",
  "qualcomm.com": "/company-logos/qualcomm.svg",
  "quicken.com": "/company-logos/quicken.svg",
  "twitch.tv": "/company-logos/twitch.svg",
  "westvirginiauniversity.com": "/company-logos/west-virginia-university.svg",

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
  // career-soft.com favicon fails; its careers site host resolves.
  "career-soft.com": "career.com",
}

const GOOGLE_FAVICON_URL_OVERRIDES: Record<string, string> = {
  // google favicon returns 404 for comcast.com; careers subdomain resolves.
  "comcast.com": "https://www.google.com/s2/favicons?sz=128&domain=jobs.comcast.com",
}

/**
 * Public logo URL for img[src] - no API key for these providers.
 * - clearbit: high-quality brand marks when available (project already allows logo.clearbit.com in next.config).
 * - unavatar: aggregates favicons / avatars; good fallback.
 * - google-favicon: always returns something small (128px).
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
      const token =
        process.env.NEXT_PUBLIC_LOGO_DEV_TOKEN ??
        process.env.LOGO_DEV_TOKEN ??
        ""
      if (token) {
        return `https://img.logo.dev/${encodeURIComponent(d)}?token=${encodeURIComponent(token)}`
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
