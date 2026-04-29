import { normalizeGreenhouseBoardUrl } from "@/lib/companies/greenhouse-url"
import { isTemporaryCareersUrl } from "@/lib/companies/ats-domains"

export type NormalizedAtsProvider =
  | "greenhouse"
  | "lever"
  | "ashby"
  | "workday"
  | "icims"
  | "smartrecruiters"
  | "bamboohr"
  | "custom"

export type AtsUrlNormalization = {
  provider: NormalizedAtsProvider
  originalUrl: string
  normalizedUrl: string
  atsIdentifier: string | null
  reason: string
  shouldPersist: boolean
}

const TRANSIENT_QUERY_PARAMS = [
  "validityToken",
  "token",
  "signature",
  "expires",
  "exp",
  "share",
  "source",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
]

function safeUrl(value: string): URL | null {
  try {
    const trimmed = value.trim()
    if (!trimmed) return null
    return new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`)
  } catch {
    return null
  }
}

function cleanIdentifier(value: string | null | undefined): string | null {
  if (!value) return null
  const cleaned = value.trim().replace(/^@+/, "")
  return /^[a-z0-9][a-z0-9._-]*$/i.test(cleaned) ? cleaned : null
}

function stripTransientParams(url: URL): URL {
  const next = new URL(url.toString())
  for (const key of TRANSIENT_QUERY_PARAMS) {
    next.searchParams.delete(key)
  }
  next.hash = ""
  return next
}

function trimTrailingSlash(url: string): string {
  const parsed = new URL(url)
  if (parsed.pathname === "/" || parsed.pathname === "") return parsed.origin
  return url.replace(/\/+$/, "")
}

function workdaySitePath(url: URL): string {
  const parts = url.pathname.split("/").filter(Boolean)
  if (parts.length === 0) return ""
  const locale = /^[a-z]{2}(?:-[a-z]{2})?$/i.test(parts[0] ?? "") ? parts[0] : null
  const site = locale ? parts[1] : parts[0]
  if (!site) return ""
  return locale ? `/${locale}/${site}` : `/${site}`
}

export function normalizeAtsUrl(
  rawUrl: string,
  context?: { atsType?: string | null }
): AtsUrlNormalization {
  const originalUrl = rawUrl.trim()
  const url = safeUrl(originalUrl)
  if (!url) {
    return {
      provider: "custom",
      originalUrl,
      normalizedUrl: originalUrl,
      atsIdentifier: null,
      reason: "invalid_url",
      shouldPersist: false,
    }
  }

  // Hard-reject URLs that carry transient/share/embed signals — those reflect
  // a single browsing session rather than a stable careers entry point. The
  // crawler must never store these as the canonical URL for a company.
  if (isTemporaryCareersUrl(originalUrl)) {
    return {
      provider: "custom",
      originalUrl,
      normalizedUrl: originalUrl,
      atsIdentifier: null,
      reason: "temporary_or_share_url",
      shouldPersist: false,
    }
  }

  const host = url.hostname.toLowerCase()
  const pathParts = url.pathname.split("/").filter(Boolean)
  const hintedProvider = context?.atsType?.toLowerCase() ?? ""

  if (host === "greenhouse.io" || host.endsWith(".greenhouse.io")) {
    const normalized = normalizeGreenhouseBoardUrl(url.toString())
    return {
      provider: "greenhouse",
      originalUrl,
      normalizedUrl: normalized.normalizedUrl ?? stripTransientParams(url).toString(),
      atsIdentifier: normalized.boardToken,
      reason: normalized.reason,
      shouldPersist: Boolean(normalized.normalizedUrl),
    }
  }

  if (host === "jobs.lever.co") {
    const company = cleanIdentifier(pathParts[0])
    return {
      provider: "lever",
      originalUrl,
      normalizedUrl: company ? `https://jobs.lever.co/${encodeURIComponent(company)}` : url.origin,
      atsIdentifier: company,
      reason: company ? "lever_company_url" : "lever_missing_company",
      shouldPersist: Boolean(company),
    }
  }

  if (host === "jobs.ashbyhq.com") {
    const company = cleanIdentifier(pathParts[0])
    return {
      provider: "ashby",
      originalUrl,
      normalizedUrl: company ? `https://jobs.ashbyhq.com/${encodeURIComponent(company)}` : url.origin,
      atsIdentifier: company,
      reason: company ? "ashby_company_url" : "ashby_missing_company",
      shouldPersist: Boolean(company),
    }
  }

  if (host === "jobs.smartrecruiters.com") {
    const company = cleanIdentifier(pathParts[0])
    return {
      provider: "smartrecruiters",
      originalUrl,
      normalizedUrl: company
        ? `https://jobs.smartrecruiters.com/${encodeURIComponent(company)}`
        : url.origin,
      atsIdentifier: company,
      reason: company ? "smartrecruiters_company_url" : "smartrecruiters_missing_company",
      shouldPersist: Boolean(company),
    }
  }

  if (host.includes("myworkdayjobs.com")) {
    const sitePath = workdaySitePath(url)
    // Store tenant/site as identifier so canonical-careers-url.ts can reconstruct
    // the Workday URL when the stored careers_url is stale.
    const tenant = host.split(".")[0] ?? null
    const siteSlug = sitePath.split("/").filter(Boolean).at(-1) ?? null
    const identifier = tenant && siteSlug ? `${tenant}/${siteSlug}` : null
    return {
      provider: "workday",
      originalUrl,
      normalizedUrl: trimTrailingSlash(`${url.origin}${sitePath}`),
      atsIdentifier: identifier,
      reason: sitePath ? "workday_tenant_site_url" : "workday_tenant_origin",
      shouldPersist: true,
    }
  }

  if (host === "icims.com" || host.endsWith(".icims.com")) {
    const clean = stripTransientParams(url)
    return {
      provider: "icims",
      originalUrl,
      normalizedUrl: trimTrailingSlash(clean.toString()),
      atsIdentifier: host === "icims.com" ? null : host.split(".")[0] ?? null,
      reason: "icims_portal_url",
      shouldPersist: host !== "icims.com" && host !== "www.icims.com",
    }
  }

  if (hintedProvider === "icims") {
    // Branded iCIMS portals use a custom host (e.g. careers.company.com) but
    // are real careers pages. Persist them; they are crawlable via the iCIMS
    // Jibe API and generic HTML fallback.
    return {
      provider: "icims",
      originalUrl,
      normalizedUrl: trimTrailingSlash(stripTransientParams(url).toString()),
      atsIdentifier: null,
      reason: "icims_branded_portal_url",
      shouldPersist: true,
    }
  }

  if (host === "bamboohr.com" || host.endsWith(".bamboohr.com")) {
    const tenant = cleanIdentifier(host.split(".")[0])
    return {
      provider: "bamboohr",
      originalUrl,
      normalizedUrl: tenant ? `https://${tenant}.bamboohr.com/careers` : `${url.origin}/careers`,
      atsIdentifier: tenant,
      reason: tenant ? "bamboohr_tenant_careers_url" : "bamboohr_missing_tenant",
      shouldPersist: Boolean(tenant),
    }
  }

  const clean = stripTransientParams(url)
  return {
    provider: "custom",
    originalUrl,
    normalizedUrl: trimTrailingSlash(clean.toString()),
    atsIdentifier: null,
    reason: "custom_careers_url",
    shouldPersist: true,
  }
}
