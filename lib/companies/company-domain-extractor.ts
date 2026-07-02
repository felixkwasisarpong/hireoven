/**
 * Recover a company's REAL website domain from its ATS careers page.
 *
 * Blank companies are created during ATS harvest with a tenant-sentinel domain
 * (`<tenant>.<ats>-tenant`) because the harvester never captured the company's
 * own site. This module extracts it from the careers-page HTML, best signal
 * first, and is name-corroborated so it under-recovers rather than mis-brands:
 *   1. schema.org JobPosting/Organization JSON-LD -> hiringOrganization.url
 *      (the company's declared site — trusted even without a name match)
 *   2. an outbound link whose registrable slug matches a company-name token
 * All candidates are filtered against ATS / social / CDN hosts.
 *
 * `resolveRealDomainFromCareers` does a cheap plain HTTP fetch (no headless
 * browser) so it is safe to call inline in the harvest path: server-rendered
 * ATS boards (greenhouse/lever/smartrecruiters) yield a domain; JS-only SPAs
 * (ashby/workable/workday) return null and the caller keeps the sentinel, no
 * worse than today. It never throws.
 */

const BAD_HOST_RE =
  /(greenhouse|lever\.co|ashbyhq|smartrecruiters|workable|myworkdayjobs|workday|icims|jobvite|bamboohr|recruitee|teamtailor|personio|breezy|jazzhr|jazz\.co|rippling|paylocity|ukg|\.adp\.|successfactors|taleo|dayforce|paycom|eightfold|phenom|linkedin|licdn|facebook|fb\.com|twitter|x\.com|instagram|youtube|tiktok|glassdoor|indeed|ziprecruiter|builtin|\.google\.|gstatic|googleapis|googletagmanager|schema\.org|w3\.org|cloudfront|amazonaws|azureedge|cloudflare|akamai|imgix|ctfassets|contentful|hotjar|segment|cookiebot|gravatar|githubusercontent|vimeo|calendly|typeform|bit\.ly|goo\.gl|adzuna|dice\.com|wistia|intercom|sentry|datadog|zscdn|transcend\.io|usercontent|zdassets|cloudinary|fastly|jsdelivr|unpkg)/i

const GENERIC = new Set([
  "the","and","of","for","inc","llc","ltd","corp","co","company","group","holdings",
  "technologies","technology","solutions","services","systems","global","international",
  "careers","jobs","team","hiring","talent",
])

function nameTokens(name: string): string[] {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter((t) => t.length >= 3 && !GENERIC.has(t))
}
function regHost(u: string): string | null { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, "") } catch { return null } }
function hostSlug(h: string): string { const l = h.split("."); return (l.length > 1 ? l.slice(0, -1) : l).join("") }
/** Drop a leading subdomain like careers./karriar. so we store the brand root. */
function regDomain(h: string): string { const l = h.split("."); return l.length > 2 ? l.slice(-2).join(".") : h }
const ok = (h: string | null, careersHost: string): h is string =>
  !!h && h !== careersHost && !BAD_HOST_RE.test(h) && /\.[a-z]{2,}$/.test(h) && h.length <= 45

function jsonLdOrgUrls(html: string): string[] {
  const urls: string[] = []
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: any
    try { data = JSON.parse(m[1]!.trim()) } catch { continue }
    const nodes: any[] = []
    const push = (x: any) => { if (x && typeof x === "object") nodes.push(x) }
    if (Array.isArray(data)) data.forEach(push)
    else { push(data); if (Array.isArray(data["@graph"])) data["@graph"].forEach(push) }
    for (const n of nodes) {
      const org = n.hiringOrganization || (String(n["@type"] || "").includes("Organization") ? n : null)
      if (!org) continue
      if (typeof org.url === "string") urls.push(org.url)
      const sa = org.sameAs
      if (Array.isArray(sa)) urls.push(...sa.filter((s: any) => typeof s === "string"))
      else if (typeof sa === "string") urls.push(sa)
    }
  }
  return urls
}

/**
 * Extract a real company domain from careers-page HTML, or null. `careersUrl`
 * is used only to exclude the ATS host itself. Name-corroborated: accepts a
 * JSON-LD hiringOrganization URL, or an outbound host whose slug matches a
 * distinctive company-name token — nothing looser (avoids grabbing vendor
 * links on busy corporate pages).
 */
export function extractCompanyDomainFromHtml(html: string, careersUrl: string, companyName: string): string | null {
  const careersHost = regHost(careersUrl) ?? ""
  for (const u of jsonLdOrgUrls(html)) { const h = regHost(u); if (ok(h, careersHost)) return regDomain(h) }
  const tokens = nameTokens(companyName)
  if (!tokens.length) return null
  const hosts = new Set<string>()
  for (const m of html.matchAll(/(?:property|rel|name)=["'](?:og:url|canonical)["'][^>]*?(?:content|href)=["'](https?:\/\/[^"']+)/gi)) { const h = regHost(m[1]!); if (ok(h, careersHost)) hosts.add(h) }
  for (const m of html.matchAll(/https?:\/\/[^\s"'<>)]+/g)) { const h = regHost(m[0]); if (ok(h, careersHost)) hosts.add(h) }
  const named = [...hosts].filter((h) => tokens.some((t) => hostSlug(h).includes(t) || (hostSlug(h).length >= 4 && t.includes(hostSlug(h)))))
  if (named.length) return regDomain(named.sort((a, b) => a.length - b.length)[0]!)
  return null
}

/** First job-detail URL on a board page (same host, deeper path) — its
 *  JobPosting JSON-LD usually carries hiringOrganization when the board didn't. */
function firstJobUrl(html: string, careersHost: string): string | null {
  for (const m of html.matchAll(/https?:\/\/[^\s"'<>)]+/g)) {
    const u = m[0]; const h = regHost(u)
    try { if (h === careersHost && /\/(jobs?|j|postings?|opportunit|position)\/[^/]+|\/[0-9a-f]{6,}/i.test(new URL(u).pathname)) return u } catch {}
  }
  return null
}

const UA = "Mozilla/5.0 (compatible; HireovenDomainExtractor/1.0; +https://hireoven.com)"

async function fetchHtml(url: string, fetchImpl: typeof fetch, timeoutMs: number): Promise<string | null> {
  try {
    const res = await fetchImpl(url, { redirect: "follow", signal: AbortSignal.timeout(timeoutMs), headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" } })
    if (!res.ok) return null
    if (!/text\/html|xml/i.test(res.headers.get("content-type") ?? "")) return null
    return (await res.text()).slice(0, 400_000)
  } catch { return null }
}

export interface ResolveDomainOptions { fetchImpl?: typeof fetch; timeoutMs?: number }

/**
 * Fetch a careers page (cheap plain HTTP, no browser) and extract the real
 * company domain, or null. Never throws. Opens the first job-detail page once
 * if the board page yields nothing (JSON-LD lives on detail pages).
 */
export async function resolveRealDomainFromCareers(
  careersUrl: string,
  companyName: string,
  options: ResolveDomainOptions = {},
): Promise<string | null> {
  if (!/^https?:\/\//i.test(careersUrl)) return null
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? 5_000
  const careersHost = regHost(careersUrl) ?? ""
  const html = await fetchHtml(careersUrl, fetchImpl, timeoutMs)
  if (!html) return null
  const direct = extractCompanyDomainFromHtml(html, careersUrl, companyName)
  if (direct) return direct
  const jobUrl = firstJobUrl(html, careersHost)
  if (!jobUrl) return null
  const jobHtml = await fetchHtml(jobUrl, fetchImpl, timeoutMs)
  if (!jobHtml) return null
  return extractCompanyDomainFromHtml(jobHtml, careersUrl, companyName)
}
