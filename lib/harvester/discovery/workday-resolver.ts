/**
 * Workday site resolution.
 *
 * crt.sh surfaces tenant subdomains like `nvidia.wd5.myworkdayjobs.com`, but
 * the harvester adapter needs `{tenant}:{wd}:{site}`. The "site" name is NOT
 * encoded in the subdomain — each Workday tenant publishes 1+ named sites
 * (e.g. "NVIDIAExternalCareerSite", "External", "Careers"). We discover them
 * via three strategies, in order of cost:
 *
 *   1. GET https://{tenant}.{wd}.myworkdayjobs.com/  — follow redirects.
 *      Some tenants redirect bare hosts to `/{locale}/{site}` so the final
 *      URL's path carries the site name. Many enterprise tenants 406 here.
 *
 *   2. GET https://{tenant}.{wd}.myworkdayjobs.com/wday/cxs/{tenant}/sites
 *      — undocumented but stable on some tenants; returns a JSON list.
 *
 *   3. POST https://{tenant}.{wd}.myworkdayjobs.com/wday/cxs/{tenant}/{candidate}/jobs
 *      — the same listing endpoint the harvester uses, but probed with common
 *      site-name candidates. First 200 wins. Slowest (multiple round-trips)
 *      but the only strategy that works reliably for big enterprise tenants
 *      that block GET on the bare host.
 *
 * Returns null when no strategy yields a site. Callers should treat null as
 * "skip this tenant; nothing to harvest from."
 */

const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_USER_AGENT =
  "hireoven-harvester/1.0 (+https://hireoven.com; bot@hireoven.com)"

export type WorkdayResolveInput = {
  tenant: string
  wd: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
  userAgent?: string
}

export type WorkdayResolveResult = {
  /** Site name, e.g. "NVIDIAExternalCareerSite". */
  site: string
  /** Strategy that produced the answer — useful for logging coverage. */
  source: "redirect" | "sites-api" | "probe"
}

/** Site-name candidates to probe via POST. Ordered by observed prevalence. */
function probeCandidates(tenant: string): string[] {
  const lower = tenant.toLowerCase()
  const upper = tenant.toUpperCase()
  const titled = lower.charAt(0).toUpperCase() + lower.slice(1)
  // De-duplicate while preserving order.
  return [...new Set([
    "External",
    "Careers",
    `${upper}ExternalCareerSite`,
    `${titled}ExternalCareerSite`,
    `${upper}Careers`,
    `${titled}Careers`,
  ])]
}

const LOCALE_RE = /^[a-z]{2}(-[a-z]{2,3})?$/i
const SITE_LABEL_RE = /^[A-Za-z0-9_-]+$/

function isLocaleSegment(seg: string): boolean {
  return LOCALE_RE.test(seg)
}

function extractSiteFromPathname(pathname: string): string | null {
  const parts = pathname.split("/").filter(Boolean)
  if (parts.length === 0) return null
  const start = isLocaleSegment(parts[0]) ? 1 : 0
  const candidate = parts[start]
  if (!candidate) return null
  const decoded = decodeURIComponent(candidate)
  return SITE_LABEL_RE.test(decoded) ? decoded : null
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  options: Pick<WorkdayResolveInput, "fetchImpl" | "timeoutMs" | "userAgent">
): Promise<Response | null> {
  const doFetch = options.fetchImpl ?? fetch
  const timeoutMs = Math.max(1_000, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await doFetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        "user-agent": options.userAgent ?? DEFAULT_USER_AGENT,
        ...(init.headers ?? {}),
      },
    })
    return response
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function tryRedirectStrategy(
  input: WorkdayResolveInput
): Promise<string | null> {
  const url = `https://${input.tenant}.${input.wd}.myworkdayjobs.com/`
  const response = await fetchWithTimeout(url, { method: "GET", redirect: "follow" }, input)
  if (!response) return null

  // The final URL after redirects carries the site in its pathname.
  // Note: response.url should reflect the final URL after all redirects.
  try {
    const finalUrl = new URL(response.url)
    if (!finalUrl.hostname.toLowerCase().endsWith(".myworkdayjobs.com")) return null
    return extractSiteFromPathname(finalUrl.pathname)
  } catch {
    return null
  }
}

type SitesApiResponse = {
  sites?: Array<{ id?: string; name?: string }>
  posting_sites?: Array<{ id?: string; name?: string }>
}

async function trySitesApiStrategy(
  input: WorkdayResolveInput
): Promise<string | null> {
  const url = `https://${input.tenant}.${input.wd}.myworkdayjobs.com/wday/cxs/${encodeURIComponent(input.tenant)}/sites`
  const response = await fetchWithTimeout(
    url,
    { method: "GET", headers: { accept: "application/json" } },
    input
  )
  if (!response || !response.ok) return null

  let data: SitesApiResponse
  try {
    data = (await response.json()) as SitesApiResponse
  } catch {
    return null
  }

  const sites = data.sites ?? data.posting_sites ?? []
  for (const site of sites) {
    const candidate = (site.name ?? site.id ?? "").trim()
    if (!candidate) continue
    if (SITE_LABEL_RE.test(candidate)) return candidate
  }
  return null
}

async function tryProbeStrategy(
  input: WorkdayResolveInput
): Promise<string | null> {
  for (const candidate of probeCandidates(input.tenant)) {
    const url = `https://${input.tenant}.${input.wd}.myworkdayjobs.com/wday/cxs/${encodeURIComponent(input.tenant)}/${encodeURIComponent(candidate)}/jobs`
    const response = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          appliedFacets: {},
          limit: 1,
          offset: 0,
          searchText: "",
        }),
      },
      input
    )
    if (response?.ok) return candidate
  }
  return null
}

export async function resolveWorkdaySite(
  input: WorkdayResolveInput
): Promise<WorkdayResolveResult | null> {
  const fromRedirect = await tryRedirectStrategy(input)
  if (fromRedirect) return { site: fromRedirect, source: "redirect" }

  const fromApi = await trySitesApiStrategy(input)
  if (fromApi) return { site: fromApi, source: "sites-api" }

  const fromProbe = await tryProbeStrategy(input)
  if (fromProbe) return { site: fromProbe, source: "probe" }

  return null
}
