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
  | "jobvite"
  | "workable"
  | "recruitee"
  | "successfactors"
  | "taleo"
  | "oraclecloud"
  | "phenom"
  | "eightfold"
  | "avature"
  | "adp"
  | "ukg"
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

function isAssetLikePath(pathname: string): boolean {
  return /\.(?:avif|css|gif|ico|jpeg|jpg|js|map|png|svg|webp|woff2?|ttf|eot)$/i.test(
    pathname
  )
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

  const host = url.hostname.toLowerCase()
  const pathParts = url.pathname.split("/").filter(Boolean)
  const hintedProvider = context?.atsType?.toLowerCase() ?? ""

  if (host === "greenhouse.io" || host.endsWith(".greenhouse.io")) {
    const normalized = normalizeGreenhouseBoardUrl(url.toString())
    if (normalized.hasValidityToken || !normalized.normalizedUrl) {
      const temporary = isTemporaryCareersUrl(originalUrl)
      return {
        provider: "custom",
        originalUrl,
        normalizedUrl: originalUrl,
        atsIdentifier: null,
        reason: normalized.hasValidityToken || temporary ? "temporary_or_share_url" : normalized.reason,
        shouldPersist: false,
      }
    }
    return {
      provider: "greenhouse",
      originalUrl,
      normalizedUrl: normalized.normalizedUrl,
      atsIdentifier: normalized.boardToken,
      reason: normalized.reason,
      shouldPersist: true,
    }
  }

  // Hard-reject URLs that carry transient/share/embed signals — those reflect
  // a single browsing session rather than a stable careers entry point. The
  // crawler must never store these as the canonical URL for a company. This
  // runs after Greenhouse so embed script URLs with a stable `for=` board token
  // can still normalize to the durable board URL.
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

  if (host === "jobs.jobvite.com") {
    const company = cleanIdentifier(pathParts[0])
    return {
      provider: "jobvite",
      originalUrl,
      normalizedUrl: company ? `https://jobs.jobvite.com/${encodeURIComponent(company)}/jobs` : url.origin,
      atsIdentifier: company,
      reason: company ? "jobvite_company_url" : "jobvite_missing_company",
      shouldPersist: Boolean(company),
    }
  }

  if (host === "apply.workable.com") {
    const company = cleanIdentifier(pathParts[0])
    return {
      provider: "workable",
      originalUrl,
      normalizedUrl: company ? `https://apply.workable.com/${encodeURIComponent(company)}/` : url.origin,
      atsIdentifier: company,
      reason: company ? "workable_company_url" : "workable_missing_company",
      shouldPersist: Boolean(company),
    }
  }

  if (host.endsWith(".recruitee.com") && host !== "recruitee.com") {
    const company = cleanIdentifier(host.replace(/\.recruitee\.com$/, ""))
    return {
      provider: "recruitee",
      originalUrl,
      normalizedUrl: company ? `https://${company}.recruitee.com/` : url.origin,
      atsIdentifier: company,
      reason: company ? "recruitee_company_url" : "recruitee_missing_company",
      shouldPersist: Boolean(company),
    }
  }

  if (host.includes("myworkdayjobs.com") || host.endsWith(".workdayjobs.com")) {
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
    const canonicalPath = clean.pathname.toLowerCase().startsWith("/jobs")
      ? "/jobs/search"
      : clean.pathname
    clean.pathname = canonicalPath
    if (canonicalPath === "/jobs/search") clean.search = ""
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

  // SAP SuccessFactors hosted career portals — one of the career{N} shards
  // on .com or .eu, addressed by the `company` query param.
  const sfMatch = host.match(/^(career(?:1[0-2]?|[2-9]))\.successfactors\.(com|eu)$/)
  if (sfMatch || host === "jobs.hr.cloud.sap") {
    const companyId = url.searchParams.get("company")
    const cleanedCompany =
      companyId && /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(companyId.trim()) ? companyId.trim() : null
    const normalized = cleanedCompany && sfMatch
      ? `https://${sfMatch[1]}.successfactors.${sfMatch[2]}/career?company=${encodeURIComponent(cleanedCompany)}`
      : trimTrailingSlash(stripTransientParams(url).toString())
    return {
      provider: "successfactors",
      originalUrl,
      normalizedUrl: normalized,
      atsIdentifier: cleanedCompany && sfMatch ? `${sfMatch[1]}.${sfMatch[2]}:${cleanedCompany}` : null,
      reason: cleanedCompany && sfMatch ? "successfactors_company_url" : "successfactors_portal_url",
      shouldPersist: Boolean(sfMatch ? cleanedCompany : host === "jobs.hr.cloud.sap"),
    }
  }

  // Oracle Taleo Enterprise Edition hosted career portals.
  if (host.endsWith(".taleo.net")) {
    const tenant = host.replace(/\.taleo\.net$/, "")
    const parts = url.pathname.split("/").filter(Boolean)
    const section = parts[0]?.toLowerCase() === "careersection" ? parts[1] : null
    const cleanedSection = section && /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(section) ? section : null
    const isInfra = tenant === "www" || tenant === "tbe" || tenant === "taleocloud"
    const shouldPersist = !isInfra && Boolean(cleanedSection)
    return {
      provider: "taleo",
      originalUrl,
      normalizedUrl: shouldPersist
        ? `https://${tenant}.taleo.net/careersection/${encodeURIComponent(cleanedSection!)}/jobsearch.ftl?lang=en`
        : trimTrailingSlash(stripTransientParams(url).toString()),
      atsIdentifier: shouldPersist ? `${tenant}:${cleanedSection}` : null,
      reason: shouldPersist ? "taleo_tenant_section_url" : "taleo_missing_section",
      shouldPersist,
    }
  }

  // Oracle Cloud HCM Candidate Experience portals.
  if (host.endsWith(".oraclecloud.com") && host !== "oraclecloud.com") {
    const pod = host.replace(/\.oraclecloud\.com$/, "")
    const isMarketing = pod === "www" || pod === "docs" || pod === "support" || pod === "blogs"
    const parts = url.pathname.split("/").filter(Boolean)
    const sitesIdx = parts.findIndex((p) => p.toLowerCase() === "sites")
    const siteRaw = sitesIdx !== -1 ? parts[sitesIdx + 1] : null
    const cleanedSite = siteRaw && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(siteRaw) ? siteRaw : null
    const shouldPersist = !isMarketing && Boolean(cleanedSite)
    return {
      provider: "oraclecloud",
      originalUrl,
      normalizedUrl: shouldPersist
        ? `https://${pod}.oraclecloud.com/hcmUI/CandidateExperience/en/sites/${encodeURIComponent(cleanedSite!)}/`
        : trimTrailingSlash(stripTransientParams(url).toString()),
      atsIdentifier: shouldPersist ? `${pod}:${cleanedSite}` : null,
      reason: shouldPersist ? "oraclecloud_pod_site_url" : "oraclecloud_missing_site",
      shouldPersist,
    }
  }

  if (host.endsWith(".phenompeople.com")) {
    const clean = stripTransientParams(url)
    const isInfra = host === "www.phenompeople.com" || host.startsWith("cdn.")
    return {
      provider: "phenom",
      originalUrl,
      normalizedUrl: trimTrailingSlash(clean.toString()),
      atsIdentifier: cleanIdentifier(host.replace(/\.phenompeople\.com$/, "")),
      reason: "phenom_portal_url",
      shouldPersist: !isInfra && !isAssetLikePath(clean.pathname),
    }
  }

  if (host.endsWith(".eightfold.ai")) {
    const clean = stripTransientParams(url)
    const isInfra = host === "eightfold.ai" || host === "www.eightfold.ai" || host.startsWith("cdn.")
    return {
      provider: "eightfold",
      originalUrl,
      normalizedUrl: trimTrailingSlash(clean.toString()),
      atsIdentifier: cleanIdentifier(host.replace(/\.eightfold\.ai$/, "")),
      reason: "eightfold_portal_url",
      shouldPersist: !isInfra && !isAssetLikePath(clean.pathname),
    }
  }

  if (host.endsWith(".avature.net")) {
    const clean = stripTransientParams(url)
    const isInfra = host === "avature.net" || host === "www.avature.net" || host.startsWith("cdn.")
    return {
      provider: "avature",
      originalUrl,
      normalizedUrl: trimTrailingSlash(clean.toString()),
      atsIdentifier: cleanIdentifier(host.replace(/\.avature\.net$/, "")),
      reason: "avature_portal_url",
      shouldPersist: !isInfra && !isAssetLikePath(clean.pathname),
    }
  }

  if (
    host === "workforcenow.adp.com" ||
    host === "recruiting.adp.com" ||
    host.endsWith(".adpemployment.com")
  ) {
    const clean = stripTransientParams(url)
    return {
      provider: "adp",
      originalUrl,
      normalizedUrl: trimTrailingSlash(clean.toString()),
      atsIdentifier: cleanIdentifier(url.searchParams.get("cid")) ?? cleanIdentifier(pathParts[0]),
      reason: "adp_recruiting_url",
      shouldPersist: true,
    }
  }

  if (host === "recruiting.ultipro.com" || host === "recruiting2.ultipro.com" || host.endsWith(".ukg.net")) {
    const clean = stripTransientParams(url)
    return {
      provider: "ukg",
      originalUrl,
      normalizedUrl: trimTrailingSlash(clean.toString()),
      atsIdentifier: cleanIdentifier(pathParts[0]) ?? cleanIdentifier(host.split(".")[0]),
      reason: "ukg_recruiting_url",
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
