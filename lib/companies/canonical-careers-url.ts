import { normalizeAtsUrl } from "@/lib/companies/ats-url-normalization"
import { isAtsDomain, isTemporaryCareersUrl } from "@/lib/companies/ats-domains"
import {
  scoreCareersUrl,
  type CareersUrlConfidence,
} from "@/lib/companies/careers-url-discovery"

export type CanonicalCareersUrlResult = {
  url: string
  confidence: CareersUrlConfidence
  reason: string
}

/**
 * Derive a canonical public careers URL for a company row.
 * Prefer patterns learned from job apply URLs (most accurate), then ATS + identifier, then known domains.
 */

export type CompanyUrlInput = {
  domain: string
  careers_url: string
  ats_type: string | null
  ats_identifier: string | null
}

/** Curated careers homepages (from seed / common ATS entry points). */
const KNOWN_DOMAIN_CAREERS: Record<string, string> = {
  "google.com": "https://careers.google.com",
  "meta.com": "https://www.metacareers.com",
  "apple.com": "https://jobs.apple.com",
  "microsoft.com": "https://jobs.careers.microsoft.com",
  "amazon.com": "https://www.amazon.jobs",
  "stripe.com": "https://stripe.com/jobs",
  "linear.app": "https://linear.app/careers",
  "vercel.com": "https://vercel.com/careers",
  "notion.so": "https://www.notion.so/careers",
  "figma.com": "https://www.figma.com/careers",
  "anthropic.com": "https://www.anthropic.com/careers",
  "openai.com": "https://openai.com/careers",
  "jpmorganchase.com": "https://careers.jpmorgan.com",
  "goldmansachs.com": "https://www.goldmansachs.com/careers",
  "cvshealth.com": "https://jobs.cvshealth.com",
  "unitedhealthgroup.com": "https://careers.unitedhealthgroup.com",
  "nike.com": "https://jobs.nike.com",
  "airbnb.com": "https://careers.airbnb.com",
  "cloudflare.com": "https://www.cloudflare.com/careers",
  "databricks.com": "https://www.databricks.com/company/careers",
}

function normalizeDomain(domain: string) {
  return domain.trim().toLowerCase().replace(/^www\./, "")
}

/**
 * Given a single job application URL, infer the best "careers site" base URL.
 */
export function inferCareersUrlFromApplyUrl(applyUrl: string): string | null {
  try {
    const u = new URL(applyUrl.trim())
    const host = u.hostname.toLowerCase()

    if (
      host.endsWith("greenhouse.io") ||
      host === "jobs.lever.co" ||
      host === "jobs.ashbyhq.com" ||
      host === "jobs.smartrecruiters.com" ||
      host.includes("myworkdayjobs.com") ||
      host.endsWith("icims.com") ||
      host.endsWith("bamboohr.com")
    ) {
      const normalized = normalizeAtsUrl(u.toString())
      return normalized.shouldPersist ? normalized.normalizedUrl : null
    }

    return null
  } catch {
    return null
  }
}

/** Pick the most common non-null string (mode). */
export function modeString(values: string[]): string | null {
  const counts = new Map<string, number>()
  for (const v of values) {
    const k = v.trim()
    if (!k) continue
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  let best: string | null = null
  let bestN = 0
  for (const [k, n] of counts) {
    if (n > bestN) {
      best = k
      bestN = n
    }
  }
  return best
}

export function inferCareersUrlFromApplyUrls(applyUrls: string[]): string | null {
  const inferred = applyUrls
    .map(inferCareersUrlFromApplyUrl)
    .filter((x): x is string => Boolean(x))
  return modeString(inferred)
}

function fromAtsIdentifier(c: CompanyUrlInput): string | null {
  const slug = c.ats_identifier?.trim()
  if (!slug) return null
  const ats = c.ats_type?.toLowerCase() ?? ""

  if (ats === "greenhouse") {
    return `https://boards.greenhouse.io/${encodeURIComponent(slug)}`
  }
  if (ats === "lever") {
    return `https://jobs.lever.co/${encodeURIComponent(slug)}`
  }
  if (ats === "ashby") {
    return `https://jobs.ashbyhq.com/${encodeURIComponent(slug)}`
  }
  if (ats === "smartrecruiters") {
    return `https://jobs.smartrecruiters.com/${encodeURIComponent(slug)}`
  }
  if (ats === "bamboohr") {
    return `https://${encodeURIComponent(slug)}.bamboohr.com/careers`
  }
  if (ats === "workday" && slug.includes("/")) {
    // ats_identifier stored as "tenant/site" e.g. "acme/External_Careers"
    const [tenant, site] = slug.split("/")
    if (tenant && site) {
      return `https://${encodeURIComponent(tenant)}.wd5.myworkdayjobs.com/${encodeURIComponent(site)}`
    }
  }
  if (ats === "jobvite") {
    return `https://jobs.jobvite.com/${encodeURIComponent(slug)}/jobs`
  }

  return null
}

/**
 * Returns true when the given `careers_url` looks like a company homepage or
 * non-careers page rather than an actual job listings page. Used to detect
 * bad stored URLs that should be flagged for review.
 */
export function careersUrlLooksLikeHomepage(url: string): boolean {
  try {
    const u = new URL(url.trim())
    const path = u.pathname.replace(/\/+$/, "").toLowerCase()

    // Root or typical homepage paths
    if (path === "" || path === "/" || path === "/home") return true

    // Obviously non-jobs paths
    const nonJobsPaths = [
      "/about",
      "/about-us",
      "/about/us",
      "/contact",
      "/contact-us",
      "/team",
      "/our-team",
      "/people",
      "/investors",
      "/press",
      "/news",
      "/blog",
      "/privacy",
      "/terms",
    ]
    if (nonJobsPaths.some((p) => path === p || path.startsWith(p + "/"))) return true

    return false
  } catch {
    return false
  }
}

/**
 * Returns true when the URL path strongly suggests it is a job listings page.
 */
export function careersUrlLooksLikeJobListings(url: string): boolean {
  try {
    const u = new URL(url.trim())
    const path = u.pathname.toLowerCase()
    return /\/(careers?|jobs?|work-with-us|join|positions?|openings?|opportunities?|vacancies?|apply|hiring)\b/.test(
      path
    )
  } catch {
    return false
  }
}

/**
 * Best-effort canonical careers URL for DB storage (HTTPS, no trailing slash except where required).
 */
export function deriveCanonicalCareersUrl(
  c: CompanyUrlInput,
  options?: { applyUrls?: string[] }
): string {
  const domain = normalizeDomain(c.domain)

  const fromJobs =
    options?.applyUrls?.length ? inferCareersUrlFromApplyUrls(options.applyUrls) : null
  if (fromJobs) return stripTrailingSlashUnlessRoot(fromJobs)

  const known = KNOWN_DOMAIN_CAREERS[domain]
  if (known) return known

  const fromAts = fromAtsIdentifier(c)
  if (fromAts) return stripTrailingSlashUnlessRoot(fromAts)

  const existing = c.careers_url?.trim()
  if (existing) {
    try {
      const fixed = existing.startsWith("http://")
        ? `https://${existing.slice("http://".length)}`
        : existing

      if (c.ats_type?.toLowerCase() === "greenhouse" || fixed.includes("greenhouse.io")) {
        const normalized = normalizeAtsUrl(fixed, { atsType: c.ats_type })
        if (normalized.shouldPersist) return normalized.normalizedUrl
      }

      const normalized = normalizeAtsUrl(fixed, { atsType: c.ats_type })
      if (normalized.provider !== "custom" && normalized.shouldPersist) {
        return normalized.normalizedUrl
      }

      // For custom ATS or unknown providers: use the existing URL only when it
      // does not appear to be a homepage or non-jobs page.
      if (!isTemporaryCareersUrl(fixed)) {
        const u = new URL(fixed)
        if (!isAtsDomain(u.hostname) && u.protocol === "https:") {
          // Prefer URLs that look like actual job listing pages over homepage URLs.
          // Homepage-looking URLs still get stored but callers can check
          // careersUrlLooksLikeHomepage() to decide whether to flag for review.
          return stripTrailingSlashUnlessRoot(u.toString())
        }
      }
    } catch {
      /* fall through */
    }
  }

  // Fallback: construct a likely careers URL from the company domain.
  // Note: this may not resolve to a real page — verify before crawling.
  return `https://${domain}/careers`
}

function stripTrailingSlashUnlessRoot(url: string) {
  const u = new URL(url)
  if (u.pathname === "/" || u.pathname === "") return u.origin
  return url.replace(/\/+$/, "")
}

/**
 * Confidence-aware variant of {@link deriveCanonicalCareersUrl}. Returns the
 * derived URL alongside a confidence label and a machine-readable reason.
 *
 *   - high:   URL is on a known ATS host (greenhouse/lever/ashby/workday/
 *             icims/smartrecruiters/bamboohr) and not temporary/share, OR is
 *             a curated KNOWN_DOMAIN_CAREERS entry.
 *   - medium: URL is on a non-ATS host with a careers/jobs path keyword.
 *   - low:    URL is the synthetic `${domain}/careers` fallback or any
 *             plain HTTPS URL with no listing signals — stored URL must NOT
 *             be auto-rewritten over an existing one at this confidence.
 *   - none:   no usable URL could be derived.
 *
 * Repair scripts should only auto-write when confidence === "high".
 */
export function deriveCanonicalCareersUrlWithConfidence(
  c: CompanyUrlInput,
  options?: { applyUrls?: string[] }
): CanonicalCareersUrlResult {
  const domain = normalizeDomain(c.domain)

  const fromJobs =
    options?.applyUrls?.length ? inferCareersUrlFromApplyUrls(options.applyUrls) : null
  if (fromJobs) {
    const stripped = stripTrailingSlashUnlessRoot(fromJobs)
    return {
      url: stripped,
      confidence: "high",
      reason: "derived_from_apply_urls",
    }
  }

  const known = KNOWN_DOMAIN_CAREERS[domain]
  if (known) {
    return { url: known, confidence: "high", reason: "curated_known_domain" }
  }

  const fromAts = fromAtsIdentifier(c)
  if (fromAts) {
    const stripped = stripTrailingSlashUnlessRoot(fromAts)
    return {
      url: stripped,
      confidence: "high",
      reason: "derived_from_ats_identifier",
    }
  }

  const existing = c.careers_url?.trim()
  if (existing) {
    try {
      const fixed = existing.startsWith("http://")
        ? `https://${existing.slice("http://".length)}`
        : existing

      if (c.ats_type?.toLowerCase() === "greenhouse" || fixed.includes("greenhouse.io")) {
        const normalized = normalizeAtsUrl(fixed, { atsType: c.ats_type })
        if (normalized.shouldPersist) {
          return {
            url: normalized.normalizedUrl,
            confidence: "high",
            reason: `normalized:${normalized.reason}`,
          }
        }
      }

      const normalized = normalizeAtsUrl(fixed, { atsType: c.ats_type })
      if (normalized.provider !== "custom" && normalized.shouldPersist) {
        return {
          url: normalized.normalizedUrl,
          confidence: "high",
          reason: `normalized:${normalized.reason}`,
        }
      }

      if (!isTemporaryCareersUrl(fixed)) {
        const u = new URL(fixed)
        if (!isAtsDomain(u.hostname) && u.protocol === "https:") {
          const stripped = stripTrailingSlashUnlessRoot(u.toString())
          const score = scoreCareersUrl(stripped)
          return {
            url: stripped,
            confidence: score.confidence === "none" ? "low" : score.confidence,
            reason: `existing_url:${score.reason}`,
          }
        }
      }
    } catch {
      /* fall through */
    }
  }

  if (!domain) {
    return { url: "", confidence: "none", reason: "missing_domain" }
  }

  // Synthetic fallback. Marked LOW so repair scripts never overwrite real
  // data with a guess at high confidence.
  return {
    url: `https://${domain}/careers`,
    confidence: "low",
    reason: "synthetic_domain_fallback",
  }
}
