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

    if (host === "boards.greenhouse.io" || host.endsWith(".greenhouse.io")) {
      const parts = u.pathname.split("/").filter(Boolean)
      if (parts[0] && parts[0] !== "embed") {
        return `https://${host}/${parts[0]}`
      }
    }

    if (host === "jobs.lever.co") {
      const parts = u.pathname.split("/").filter(Boolean)
      if (parts[0]) {
        return `https://jobs.lever.co/${parts[0]}`
      }
    }

    if (host === "jobs.ashbyhq.com") {
      const parts = u.pathname.split("/").filter(Boolean)
      if (parts[0]) {
        return `https://jobs.ashbyhq.com/${parts[0]}`
      }
    }

    if (host.includes("myworkdayjobs.com")) {
      return u.origin
    }

    if (host.endsWith("icims.com")) {
      // Exclude the iCIMS marketing site — only return branded portals (*.icims.com with prefix).
      if (host === "icims.com" || host === "www.icims.com") return null
      return u.origin
    }

    if (host.endsWith("bamboohr.com") && u.pathname.includes("careers")) {
      return `${u.origin}/careers`
    }

    if (host.endsWith("bamboohr.com")) {
      return `${u.origin}/careers`
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
  if (ats === "bamboohr") {
    return `https://${encodeURIComponent(slug)}.bamboohr.com/careers`
  }

  return null
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
      const u = new URL(fixed)
      if (u.protocol === "https:") {
        return stripTrailingSlashUnlessRoot(u.toString())
      }
    } catch {
      /* fall through */
    }
  }

  return `https://${domain}/careers`
}

function stripTrailingSlashUnlessRoot(url: string) {
  const u = new URL(url)
  if (u.pathname === "/" || u.pathname === "") return u.origin
  return url.replace(/\/+$/, "")
}
