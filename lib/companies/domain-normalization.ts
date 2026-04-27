import { companyLogoUrlFromDomain, normalizeCompanyDomain } from "@/lib/companies/logo-url"

const PLACEHOLDER_DOMAIN_RE = /\.(uscis-employer|lca-employer)$/i

function domainFromUrlLike(value: string | null | undefined): string | null {
  if (!value?.trim()) return null
  try {
    const raw = value.includes("://") ? value : `https://${value}`
    const host = new URL(raw).hostname
    const normalized = normalizeCompanyDomain(host)
    return normalized || null
  } catch {
    return null
  }
}

function domainFromLogoUrl(logoUrl: string | null | undefined): string | null {
  if (!logoUrl?.trim()) return null
  try {
    const url = new URL(logoUrl)
    const host = url.hostname.toLowerCase()

    if (host.includes("google.com") || host.endsWith(".gstatic.com")) {
      return normalizeCompanyDomain(url.searchParams.get("domain") ?? url.searchParams.get("domain_url") ?? "")
    }

    if (host === "logo.clearbit.com" || host === "unavatar.io") {
      return normalizeCompanyDomain(url.pathname.replace(/^\/+/, ""))
    }

    if (host === "icons.duckduckgo.com") {
      const match = url.pathname.replace(/^\/+/, "").match(/^ip3\/(.+)\.ico$/i)
      return normalizeCompanyDomain(match?.[1] ?? "")
    }

    if (host === "icon.horse") {
      const match = url.pathname.replace(/^\/+/, "").match(/^icon\/(.+)$/i)
      return normalizeCompanyDomain(match?.[1] ?? "")
    }

    if (host === "www.google.com" || host === "google.com") return null
    return normalizeCompanyDomain(host)
  } catch {
    return null
  }
}

export function isPlaceholderCompanyDomain(domain: string | null | undefined): boolean {
  if (!domain) return false
  return PLACEHOLDER_DOMAIN_RE.test(normalizeCompanyDomain(domain))
}

export function resolveCompanyDomain({
  domain,
  careersUrl,
  logoUrl,
}: {
  domain: string | null | undefined
  careersUrl: string | null | undefined
  logoUrl: string | null | undefined
}): string | null {
  const normalizedDomain = domain ? normalizeCompanyDomain(domain) : ""
  const normalizedCareers = domainFromUrlLike(careersUrl)
  const normalizedLogo = domainFromLogoUrl(logoUrl)

  if (normalizedDomain && !isPlaceholderCompanyDomain(normalizedDomain)) return normalizedDomain
  if (normalizedCareers && !isPlaceholderCompanyDomain(normalizedCareers)) return normalizedCareers
  if (normalizedLogo && !isPlaceholderCompanyDomain(normalizedLogo)) return normalizedLogo
  return normalizedDomain || normalizedCareers || normalizedLogo || null
}

export function resolveCompanyLogoUrl({
  domain,
  logoUrl,
}: {
  domain: string | null | undefined
  logoUrl: string | null | undefined
}): string | null {
  if (logoUrl?.trim()) return logoUrl
  const normalizedDomain = domain ? normalizeCompanyDomain(domain) : ""
  if (!normalizedDomain) return null
  return companyLogoUrlFromDomain(normalizedDomain)
}
