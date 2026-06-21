/**
 * VC portfolio-page discovery.
 *
 * Top venture firms publish their portfolio companies on public HTML pages,
 * each company linked out to its own homepage. That outbound link list is a
 * free roster of well-funded startups whose careers pages we likely don't yet
 * cover. Pull the external company domains from the portfolio HTML, then the
 * driving script probes each domain's /careers + /jobs pages and enrolls any
 * adapter-matched ATS URL via enrollFromApplyUrl().
 *
 * The extraction is intentionally dumb: scrape every anchor href, normalize to
 * a bare domain, drop the VC's own host plus the usual social / aggregator
 * noise, dedupe. No company names or descriptions are parsed — the script
 * derives a placeholder name from the domain label and lets the real harvest
 * fill in the rest.
 *
 * No DB / network coupling here beyond a thin fetch wrapper, so the parsing is
 * unit-tested with canned HTML and an injected fetchImpl.
 */

const DEFAULT_TIMEOUT_MS = 20_000
const DEFAULT_USER_AGENT =
  "hireoven-harvester/1.0 (+https://hireoven.com; bot@hireoven.com)"

/** Hosts that are never a portfolio company's own domain. */
const NON_COMPANY_HOSTS = new Set([
  "twitter.com",
  "x.com",
  "linkedin.com",
  "facebook.com",
  "fb.com",
  "instagram.com",
  "youtube.com",
  "youtu.be",
  "vimeo.com",
  "medium.com",
  "substack.com",
  "crunchbase.com",
  "github.com",
  "gitlab.com",
  "pinterest.com",
  "tiktok.com",
  "reddit.com",
  "threads.net",
  "apple.com",
  "play.google.com",
  "apps.apple.com",
  "google.com",
  "goo.gl",
  "bit.ly",
  "t.co",
  "mailto",
  "wikipedia.org",
  "angellist.com",
  "wellfound.com",
])

/** Domain suffixes/labels that signal non-company assets, not portfolio links. */
const NON_COMPANY_SUFFIX_HOSTS = [
  "googleapis.com",
  "gstatic.com",
  "cloudfront.net",
  "akamaihd.net",
  "wp.com",
  "wordpress.com",
  "squarespace.com",
  "typeform.com",
  "calendly.com",
  "fonts.com",
]

export type VcPortfolioSource = {
  /** Display label for logs/telemetry (the fund name). */
  name: string
  /** Public portfolio page URL to fetch (static HTML). */
  url: string
}

/**
 * Curated list of well-known VC portfolio pages. URLs point at the public
 * portfolio listing for each firm. Override per-run via --source= on the
 * driving script.
 */
export const DEFAULT_VC_PORTFOLIOS: VcPortfolioSource[] = [
  { name: "Andreessen Horowitz", url: "https://a16z.com/portfolio/" },
  { name: "Sequoia Capital", url: "https://www.sequoiacap.com/our-companies/" },
  { name: "Accel", url: "https://www.accel.com/relationships" },
  { name: "Index Ventures", url: "https://www.indexventures.com/companies/" },
  { name: "Bessemer Venture Partners", url: "https://www.bvp.com/companies" },
  { name: "Founders Fund", url: "https://foundersfund.com/portfolio/" },
  { name: "Greylock Partners", url: "https://greylock.com/portfolio/" },
  { name: "Lightspeed Venture Partners", url: "https://lsvp.com/portfolio/" },
  { name: "Kleiner Perkins", url: "https://www.kleinerperkins.com/companies/" },
  { name: "New Enterprise Associates", url: "https://www.nea.com/portfolio" },
]

/** Normalize an href into a bare registrable-ish domain, or null if not one. */
function hrefToDomain(href: string): string | null {
  const raw = href.trim()
  if (!raw) return null
  // Skip in-page / relative / non-http schemes early.
  if (raw.startsWith("#") || raw.startsWith("/") || raw.startsWith("mailto:")) {
    return null
  }
  const lower = raw.toLowerCase()
  const withScheme = /^https?:\/\//.test(lower) ? lower : `https://${lower}`
  let host: string
  try {
    host = new URL(withScheme).hostname
  } catch {
    return null
  }
  host = host.replace(/^www\./, "")
  if (!host.includes(".") || /\s/.test(host)) return null
  return host
}

/**
 * Pull external portfolio-company domains from portfolio-page HTML.
 *
 * Scans every anchor href, normalizes to a bare domain, and excludes the VC's
 * own domain plus common social / aggregator / asset hosts. De-duplicated,
 * insertion-ordered.
 */
export function extractCompanyDomains(html: string, ownDomain?: string): string[] {
  const own = ownDomain ? ownDomain.toLowerCase().replace(/^www\./, "") : null
  const out: string[] = []
  const seen = new Set<string>()

  for (const m of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    const domain = hrefToDomain(m[1]!)
    if (!domain) continue
    if (seen.has(domain)) continue
    if (own && (domain === own || domain.endsWith(`.${own}`))) continue
    if (NON_COMPANY_HOSTS.has(domain)) continue
    // Drop subdomains of well-known social hosts too (e.g. business.facebook.com).
    if ([...NON_COMPANY_HOSTS].some((h) => domain.endsWith(`.${h}`))) continue
    if (NON_COMPANY_SUFFIX_HOSTS.some((s) => domain === s || domain.endsWith(`.${s}`))) {
      continue
    }
    seen.add(domain)
    out.push(domain)
  }

  return out
}

/** Derive the VC's own hostname from its portfolio page URL. */
function ownDomainOf(source: VcPortfolioSource): string | undefined {
  try {
    return new URL(source.url).hostname.replace(/^www\./, "")
  } catch {
    return undefined
  }
}

/**
 * Fetch a portfolio page and return its external company domains. Mirrors
 * fetchSeedSource error handling: returns [] on any non-2xx / network failure.
 */
export async function fetchPortfolioDomains(
  source: VcPortfolioSource,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}
): Promise<string[]> {
  const doFetch = options.fetchImpl ?? fetch
  const timeoutMs = Math.max(1_000, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await doFetch(source.url, {
      headers: { "user-agent": DEFAULT_USER_AGENT },
      signal: controller.signal,
    })
    if (!response.ok) return []
    const html = await response.text()
    return extractCompanyDomains(html, ownDomainOf(source))
  } catch {
    return []
  } finally {
    clearTimeout(timer)
  }
}
