/**
 * Common Crawl CDX Index API client.
 *
 * The CDX API returns every URL that Common Crawl crawled matching a given
 * pattern. It is free, requires no API key, and is the cheapest possible way
 * to discover ATS tenant URLs that are already publicly indexed.
 *
 * Endpoint: https://index.commoncrawl.org/{index}/url
 *   ?url=*.boards.greenhouse.io
 *   &matchType=domain
 *   &output=json
 *   &limit=200000
 *   &fl=url,status,timestamp
 *
 * Responses are JSONL (one JSON object per newline), NOT a JSON array.
 * Each line looks like: {"url":"https://...","status":"200","timestamp":"..."}
 *
 * The CC index lags ~3-6 months behind the current date. It is best used as
 * a bulk seed source, not for real-time discovery.
 *
 * Index names: see https://index.commoncrawl.org/ for the latest crawl ID.
 */

export type CdxEntry = {
  url: string
  status: string
  timestamp: string
}

export type CdxQueryOptions = {
  /** Override the CC index identifier. Defaults to CC_INDEX env var or the
   *  latest known index baked into this module. Update ~quarterly. */
  index?: string
  /** Max rows to fetch. Default 200_000. CDX can return millions; cap it. */
  limit?: number
  /** Fetch implementation override for tests. */
  fetchImpl?: typeof fetch
  /** Request timeout in ms. Default 120s — CDX queries can be slow. */
  timeoutMs?: number
  /** Override the CDX `url` match pattern. Defaults to `{apex}/*` (path prefix
   *  under a single host). Pass a domain-wildcard form like
   *  `*.myworkdayjobs.com` (optionally with a `/path/*` suffix) to enumerate
   *  subdomain-per-tenant ATSes that CC DOES index at the subdomain level. */
  urlPattern?: string
}

// Fallback used when the live index list can't be fetched. Latest list:
// https://index.commoncrawl.org/collinfo.json
export const DEFAULT_CC_INDEX = process.env.CC_INDEX ?? "CC-MAIN-2026-21"

// Resolve the newest published Common Crawl index at runtime so miners always hit
// the freshest crawl (a new one drops ~monthly) instead of a hardcoded stale one.
// CC_INDEX env (explicit override) wins; on any fetch failure we fall back to the
// constant above.
export async function getLatestCcIndex(): Promise<string> {
  if (process.env.CC_INDEX) return process.env.CC_INDEX
  try {
    const res = await fetch("https://index.commoncrawl.org/collinfo.json", {
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return DEFAULT_CC_INDEX
    const cols = (await res.json()) as Array<{ id?: string }>
    const latest = cols.find((c) => typeof c.id === "string" && /^CC-MAIN-\d{4}-\d+$/.test(c.id))?.id
    return latest ?? DEFAULT_CC_INDEX
  } catch {
    return DEFAULT_CC_INDEX
  }
}
// The CDX endpoint uses {index}-index suffix, NOT {index}/url.
// Correct format: http://index.commoncrawl.org/{index}-index?url=...
const CDX_BASE = "http://index.commoncrawl.org"

/**
 * Query the CDX API for all URLs matching `*.{apex}` that returned HTTP 200.
 * Returns parsed JSONL entries, deduped by URL.
 *
 * The caller is responsible for normalising the URLs to canonical board roots
 * via `normalizeCdxUrlToBoard()`.
 */
export async function queryCdxForApex(
  apex: string,
  options: CdxQueryOptions = {}
): Promise<CdxEntry[]> {
  const index     = options.index ?? DEFAULT_CC_INDEX
  const limit     = options.limit ?? 200_000
  const timeoutMs = options.timeoutMs ?? 120_000
  const doFetch   = options.fetchImpl ?? fetch

  // Query all paths under the apex domain using prefix match.
  // CDX requires the full URL form: "{apex}/*" to match all paths. Callers can
  // override this (e.g. "*.myworkdayjobs.com") for subdomain-per-tenant ATSes.
  const params = new URLSearchParams({
    url:    options.urlPattern ?? `${apex}/*`,
    output: "json",
    limit:  String(limit),
    fl:     "url,status,timestamp",
  })
  // Endpoint format: {base}/{index}-index?{params}
  const endpoint = `${CDX_BASE}/${index}-index?${params}`

  const ctrl  = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)

  let text: string
  try {
    const res = await doFetch(endpoint, {
      headers: {
        "user-agent": "hireoven-harvester/1.0 (+https://hireoven.com; bot@hireoven.com)",
        accept: "application/json",
      },
      signal: ctrl.signal,
    })
    clearTimeout(timer)
    // 404 from CDX means "no captures found" — return empty, not an error.
    if (res.status === 404) return []
    if (!res.ok) throw new Error(`CDX returned ${res.status} for apex=${apex}`)
    text = await res.text()
  } catch (err) {
    clearTimeout(timer)
    throw err
  }

  const seen = new Set<string>()
  const entries: CdxEntry[] = []

  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let parsed: Record<string, unknown>
    try { parsed = JSON.parse(trimmed) } catch { continue }

    const url       = typeof parsed.url === "string" ? parsed.url : null
    const status    = typeof parsed.status === "string" ? parsed.status : ""
    const timestamp = typeof parsed.timestamp === "string" ? parsed.timestamp : ""

    if (!url || seen.has(url)) continue
    // Accept 2xx (content) and 3xx (redirects) — both mean the URL exists.
    // Greenhouse boards return 301; Lever/Ashby return 200. Skip 4xx/5xx/0.
    const code = Number.parseInt(status, 10)
    if (Number.isNaN(code) || code < 200 || code >= 400) continue
    seen.add(url)
    entries.push({ url, status, timestamp })
  }

  return entries
}

/**
 * Normalize a CDX URL (which may be a deep job-detail page) to the canonical
 * ATS board root, using the `detectAdapter` adapter registry.
 *
 * Returns null when the URL doesn't resolve to a supported ATS board root
 * (e.g. it's a vendor infra page, a login page, etc.).
 */
export function normalizeCdxUrlToBoard(
  url: string,
  detectAdapter: (url: string) => { adapter: { name: string }; slug: string } | null
): { atsType: string; slug: string; careersUrl: string } | null {
  let parsed: URL
  try { parsed = new URL(url) } catch { return null }

  // Strip query string and fragments — board roots never need them.
  const clean = `${parsed.protocol}//${parsed.hostname}${parsed.pathname}`.replace(/\/+$/, "")

  const det = detectAdapter(clean) ?? detectAdapter(url)
  if (!det) return null

  return {
    atsType:    det.adapter.name,
    slug:       det.slug,
    careersUrl: clean,
  }
}
