import pLimit from "p-limit"
import {
  envConcurrency,
  hashContent,
  linkAbortSignal,
  throwIfAborted,
  type AtsAdapter,
  type HarvestCtx,
  type HarvestResult,
  type HarvestedJob,
} from "@/lib/harvester/adapters/_base"
import { harvesterFetch } from "@/lib/harvester/http-agent"

/**
 * Workday CXS (Candidate Experience Service) public API.
 *
 *   POST https://{tenant}.wd{N}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs
 *   Body: { appliedFacets: {}, limit: 20, offset: N, searchText: "" }
 *
 * Each tenant has its own `wd{N}` host (wd1..wd103+) and one-or-more "site"
 * names (e.g. "External", "NVIDIAExternalCareerSite"). The slug we store is a
 * colon-delimited tuple `{tenant}:{wd}:{site}` so a single string round-trips
 * everything the adapter needs.
 *
 * Job descriptions live behind a separate per-job detail fetch — way too slow
 * for the freshness budget, so v1 only emits titles + locations + postedOn.
 * A background enrichment job can backfill descriptions.
 */

const PAGE_LIMIT = 20
const MAX_PAGES = 50 // legacy naive-pagination ceiling (kept for the budget default)
const DEFAULT_LOCALE = "en-US"

// --- Facet subdivision (breaks Workday's 2,000-per-query cap) ---------------
// Workday caps a query's reported `total` at 2,000 and silently wraps pagination
// back to page 1 past offset 2,000 — so naive pagination can NEVER collect more
// than 2K unique jobs from a tenant, no matter the page ceiling. When a query
// reports the cap we subdivide by a facet (each child query has its own ≤2K cap;
// dedup by externalId absorbs overlap). Priority mirrors jobhive: broad "area of
// work" first, then time-type, then location, then the high-cardinality
// skills facet as a last resort.
const QUERY_TOTAL_CAP = 2000
const MAX_SUBDIVISION_DEPTH = 4
const SUBDIVISION_FACETS = ["jobFamilyGroup", "timeType", "locations", "workerSubType"]
// Hard ceiling on POSTs per company so one huge tenant (Accenture ~60k) can't
// run unbounded — it partial-harvests within the deadline and backfills next
// cycle. Defaults to 400 pages (~8k jobs), far above the old 1k cap.
const MAX_TOTAL_PAGES = Math.max(
  MAX_PAGES,
  Number.parseInt(process.env.HARVESTER_WORKDAY_MAX_PAGES ?? "400", 10)
)
// Concurrency for listing POSTs within a single company. Workday is routed
// through the residential proxy (see http-agent); a small pool keeps the
// subdivision fast enough to finish inside COMPANY_DEADLINE_MS without tripping
// the WAF. The cross-company adapter concurrency is separate (see below).
const LISTING_CONCURRENCY = Math.max(
  1,
  Number.parseInt(process.env.HARVESTER_WORKDAY_LISTING_CONCURRENCY ?? "4", 10)
)
// Workday's WAF flags obvious bot UAs; a real-browser UA + matching
// Origin/Referer headers reduce 403s on stricter tenants.
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
const DEFAULT_TIMEOUT_MS = 15_000
const RETRY_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504])

function browserHeadersForUrl(url: string, userAgent: string): Record<string, string> {
  let origin: string | null = null
  let referer: string | null = null
  try {
    const u = new URL(url)
    origin = `${u.protocol}//${u.host}`
    // Referer is the careers landing page (strip /wday/cxs/... API path).
    const cxsIdx = u.pathname.indexOf("/wday/cxs/")
    referer = cxsIdx > 0 ? `${origin}${u.pathname.slice(0, cxsIdx)}` : origin
  } catch {
    /* fall through */
  }
  const headers: Record<string, string> = {
    "user-agent": userAgent,
    "accept-language": "en-US,en;q=0.9",
  }
  if (origin) headers.origin = origin
  if (referer) headers.referer = referer
  return headers
}

// Per-job detail fetch — enriches descriptions beyond the bullet snippets.
// Env-tunable for operators who want to trade throughput for richer text.
//
// Keep this bounded in the main worker. Large Workday tenants can expose
// 1000+ jobs; aggressive per-job detail enrichment belongs in backfills, not
// the freshness harvester that shares CPU/RAM with every other adapter.
const DETAIL_MAX_JOBS = Math.max(
  0,
  Number.parseInt(process.env.HARVESTER_WORKDAY_DETAIL_MAX_JOBS ?? "120", 10)
)
const DETAIL_CONCURRENCY = Math.max(
  1,
  Number.parseInt(process.env.HARVESTER_WORKDAY_DETAIL_CONCURRENCY ?? "3", 10)
)
const DETAIL_TIMEOUT_MS = Math.max(
  1_000,
  Number.parseInt(process.env.HARVESTER_WORKDAY_DETAIL_TIMEOUT_MS ?? "8000", 10)
)
// Overall per-company wall-clock budget. A single slow Workday tenant (up to 50
// paginated POSTs + per-job detail) can otherwise burn the worker's whole 300s
// tick watchdog and starve the other 9 companies claimed in the same batch —
// the observed `company_hang` / `tick_timeout` pattern on big boards (Northrop
// Grumman, Accenture, Visa, …). When the budget is exhausted we stop early and
// return a partial harvest; the remaining pages/details backfill next cycle.
const COMPANY_DEADLINE_MS = Math.max(
  20_000,
  Number.parseInt(process.env.HARVESTER_WORKDAY_COMPANY_DEADLINE_MS ?? "75000", 10)
)

type WorkdayLocation = { descriptor?: string }

type WorkdayPosting = {
  externalPath?: string
  title?: string
  locationsText?: string
  locations?: WorkdayLocation[]
  postedOn?: string
  bulletFields?: string[]
}

type WorkdayFacetValue = { id?: string; count?: number }
type WorkdayFacet = { facetParameter?: string; values?: WorkdayFacetValue[] }

type WorkdayListingResponse = {
  total?: number
  jobPostings?: WorkdayPosting[]
  // Facet buckets with per-value counts — used to subdivide capped tenants.
  facets?: WorkdayFacet[]
}

type ParsedSlug = {
  tenant: string
  wd: string
  site: string
}

// Real tenant (subdomain AND cxs API path) can contain an underscore — found
// live: Sallie Mae's Workday tenant is "sallie_mae" on both, even though
// "_" is technically invalid in DNS hostnames (Workday's own platform
// tolerates it — verified directly against the live cxs API and subdomain).
const WD_HOST_RE = /^([a-z0-9_-]+)\.(wd\d{1,3})\.myworkdayjobs\.com$/i

/**
 * Workday's other careers host. Same boards, different shape: the tenant moves
 * out of the subdomain and into the path.
 *
 *   sysco.wd5.myworkdayjobs.com/syscocareers
 *   wd5.myworkdaysite.com/recruiting/sysco/syscocareers
 *
 * Both answer the same CXS endpoint with the same payload — verified live: each
 * returns total=2000 with an identical first posting for Sysco. So this form is
 * normalised onto the existing `tenant:wd:site` slug rather than given its own,
 * which also means pasting either URL resolves to one company record instead of
 * two.
 */
const WD_SITE_HOST_RE = /^(wd\d{1,3})\.myworkdaysite\.com$/i

function isLocaleSegment(segment: string): boolean {
  return /^[a-z]{2}(-[a-z]{2,3})?$/i.test(segment)
}

function parseSlug(slug: string): ParsedSlug | null {
  const parts = slug.split(":")
  if (parts.length !== 3) return null
  const [tenant, wd, site] = parts
  if (!tenant || !wd || !site) return null
  if (!/^[a-z0-9_-]+$/i.test(tenant)) return null
  if (!/^wd\d{1,3}$/i.test(wd)) return null
  if (!/^[A-Za-z0-9_-]+$/.test(site)) return null
  return { tenant, wd, site }
}

function detectFromUrl(url: string): { slug: string } | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }

  const host = parsed.hostname.toLowerCase()
  const parts = parsed.pathname
    .split("/")
    .filter(Boolean)
    .map((p) => decodeURIComponent(p).trim())
    .filter(Boolean)

  const m = host.match(WD_HOST_RE)
  if (m) {
    const tenant = m[1]
    const wd = m[2]
    // Strip leading locale segment (e.g. `en-US`) — the site name follows.
    const startIdx = parts.length > 0 && isLocaleSegment(parts[0]) ? 1 : 0
    const site = parts[startIdx]
    if (!site) return null
    if (!/^[A-Za-z0-9_-]+$/.test(site)) return null
    return { slug: `${tenant}:${wd}:${site}` }
  }

  // wd5.myworkdaysite.com/recruiting/<tenant>/<site>, optionally locale-prefixed
  // (/en-US/recruiting/...). The tenant lives in the path here, not the host.
  const site = host.match(WD_SITE_HOST_RE)
  if (site) {
    const wd = site[1]
    const start = parts.length > 0 && isLocaleSegment(parts[0]) ? 1 : 0
    if (parts[start]?.toLowerCase() !== "recruiting") return null
    const tenant = parts[start + 1]
    const boardSite = parts[start + 2]
    if (!tenant || !boardSite) return null
    if (!/^[a-z0-9_-]+$/i.test(tenant)) return null
    if (!/^[A-Za-z0-9_-]+$/.test(boardSite)) return null
    return { slug: `${tenant}:${wd}:${boardSite}` }
  }

  return null
}

function listingUrl(parsed: ParsedSlug): string {
  return `https://${parsed.tenant}.${parsed.wd}.myworkdayjobs.com/wday/cxs/${encodeURIComponent(parsed.tenant)}/${encodeURIComponent(parsed.site)}/jobs`
}

function applyUrlFor(parsed: ParsedSlug, externalPath: string | undefined, locale = DEFAULT_LOCALE): string {
  const base = `https://${parsed.tenant}.${parsed.wd}.myworkdayjobs.com/${locale}/${encodeURIComponent(parsed.site)}`
  if (!externalPath) return base
  const suffix = externalPath.startsWith("/") ? externalPath : `/${externalPath}`
  return `${base}${suffix}`
}

function externalIdFor(externalPath: string | undefined, title: string): string {
  if (externalPath) return `workday:${externalPath}`
  // Fallback for postings that lack an externalPath: hash the title + posted_on
  return `workday:title:${title}`
}

/**
 * Workday's `postedOn` is human-readable text ("Posted Today",
 * "Posted 5 Days Ago", "Posted 30+ Days Ago"), not an ISO timestamp.
 * Convert relative phrases to an ISO date; drop anything we can't parse so
 * the persist layer doesn't fail on `::timestamptz` cast.
 */
function parseWorkdayPostedOn(value: string | undefined | null): string | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined

  // Already ISO-ish?
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    const d = new Date(trimmed)
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
  }

  const lower = trimmed.toLowerCase()
  if (lower === "posted today" || lower === "today") {
    return new Date().toISOString()
  }
  if (lower === "posted yesterday" || lower === "yesterday") {
    return new Date(Date.now() - 86_400_000).toISOString()
  }

  // "Posted N Days Ago" or "Posted N+ Days Ago"
  const daysMatch = lower.match(/^(?:posted\s+)?(\d+)\+?\s+days?\s+ago$/)
  if (daysMatch) {
    const days = Number.parseInt(daysMatch[1], 10)
    if (Number.isFinite(days)) {
      return new Date(Date.now() - days * 86_400_000).toISOString()
    }
  }

  // Unrecognized — drop rather than poison the timestamptz cast.
  return undefined
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;?/gi, " ")
    .replace(/&amp;?/gi, "&")
    .replace(/&quot;?/gi, '"')
    .replace(/&#39;?|&apos;?/gi, "'")
    .replace(/&lt;?/gi, "<")
    .replace(/&gt;?/gi, ">")
    .replace(/&mdash;?/gi, "-")
    .replace(/&ndash;?/gi, "–")
    .replace(/&bull;?/gi, "•")
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex: string) => {
      const code = Number.parseInt(hex, 16)
      if (!Number.isFinite(code) || code < 32 || code > 0x10ffff) return ""
      try {
        return String.fromCodePoint(code)
      } catch {
        return ""
      }
    })
    .replace(/&#(\d+);?/g, (_, dec: string) => {
      const code = Number.parseInt(dec, 10)
      if (!Number.isFinite(code) || code < 32 || code > 0x10ffff) return ""
      try {
        return String.fromCodePoint(code)
      } catch {
        return ""
      }
    })
}

function stripHtml(value: string | undefined | null): string | undefined {
  if (!value) return undefined
  const text = decodeHtmlEntities(value)
    .replace(/\r\n?/g, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/(p|div|section|article|ul|ol|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .split("\n")
    .map((line) =>
      line
        .replace(/[ \t]+/g, " ")
        .replace(/\s+([,.;:!?])/g, "$1")
        .trim()
    )
    .filter(Boolean)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  return text || undefined
}

type WorkdayDetailResponse = {
  jobPostingInfo?: {
    jobDescription?: string
    briefDescription?: string
    location?: string
    jobRequisitionLocation?: {
      descriptor?: string
      country?: { descriptor?: string; alpha2Code?: string }
    }
  }
}

/**
 * Build the per-job detail URL from the parsed slug and the listing's
 * `externalPath` (which starts with `/`).
 */
export function detailUrlFor(parsed: ParsedSlug, externalPath: string): string {
  const base = `https://${parsed.tenant}.${parsed.wd}.myworkdayjobs.com/wday/cxs/${encodeURIComponent(parsed.tenant)}/${encodeURIComponent(parsed.site)}`
  const suffix = externalPath.startsWith("/") ? externalPath : `/${externalPath}`
  return `${base}${suffix}`
}

/**
 * Fetch a single job's detail payload (description + canonical location).
 * Returns null on any error; callers should fall back to whatever the
 * listing produced.
 */
export async function fetchWorkdayJobDetail(
  parsed: ParsedSlug,
  externalPath: string,
  ctx: HarvestCtx
): Promise<{ description?: string; location?: string } | null> {
  const doFetch = ctx.fetchImpl ?? harvesterFetch
  const userAgent = ctx.userAgent ?? DEFAULT_USER_AGENT
  const url = detailUrlFor(parsed, externalPath)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DETAIL_TIMEOUT_MS)
  const unlinkAbortSignal = linkAbortSignal(ctx.signal, controller)

  try {
    throwIfAborted(ctx.signal)
    const response = await doFetch(url, {
      method: "GET",
      headers: {
        ...browserHeadersForUrl(url, userAgent),
        accept: "application/json",
      },
      signal: controller.signal,
    })
    if (!response.ok) return null
    const data = (await response.json()) as WorkdayDetailResponse
    const info = data.jobPostingInfo
    if (!info) return null

    const description = stripHtml(info.jobDescription) ?? stripHtml(info.briefDescription)

    // Prefer the country-qualified descriptor for location resolution.
    const reqLoc = info.jobRequisitionLocation
    const country = reqLoc?.country?.descriptor
    let location: string | undefined
    if (reqLoc?.descriptor?.trim()) {
      location = country && !reqLoc.descriptor.includes(country)
        ? `${reqLoc.descriptor.trim()}, ${country}`
        : reqLoc.descriptor.trim()
    } else if (info.location?.trim()) {
      location = info.location.trim()
    }

    return { description, location }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
    unlinkAbortSignal()
  }
}

function pickLocation(raw: WorkdayPosting): string | undefined {
  if (raw.locationsText?.trim()) return raw.locationsText.trim()
  const desc = raw.locations?.find((l) => l?.descriptor?.trim())?.descriptor?.trim()
  return desc || undefined
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

type PostFetchResult =
  | { kind: "ok"; status: number; data: WorkdayListingResponse; upstreamLatencyMs: number }
  | { kind: "error"; status: number | null; reason: string; upstreamLatencyMs: number }

async function postWorkdayListing(
  url: string,
  body: unknown,
  ctx: HarvestCtx,
  options: { maxAttempts?: number } = {}
): Promise<PostFetchResult> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3)
  const userAgent = ctx.userAgent ?? DEFAULT_USER_AGENT
  const timeoutMs = Math.max(1_000, ctx.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const doFetch = ctx.fetchImpl ?? harvesterFetch

  let attempt = 0
  let lastReason = "unknown"
  let lastStatus: number | null = null
  let upstreamLatencyMs = 0

  while (attempt < maxAttempts) {
    attempt += 1
    const startedAt = Date.now()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const unlinkAbortSignal = linkAbortSignal(ctx.signal, controller)

    try {
      throwIfAborted(ctx.signal)
      const response = await doFetch(url, {
        method: "POST",
        headers: {
          ...browserHeadersForUrl(url, userAgent),
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      upstreamLatencyMs += Date.now() - startedAt

      if (response.ok) {
        const data = (await response.json()) as WorkdayListingResponse
        return { kind: "ok", status: response.status, data, upstreamLatencyMs }
      }

      lastStatus = response.status
      lastReason = `http_${response.status}`
      if (!RETRY_STATUSES.has(response.status) || attempt >= maxAttempts) {
        return { kind: "error", status: response.status, reason: lastReason, upstreamLatencyMs }
      }
      const retryAfter = response.headers.get("retry-after")
      const retryAfterSec = retryAfter ? Number.parseFloat(retryAfter) : NaN
      const backoff = Number.isFinite(retryAfterSec)
        ? Math.min(retryAfterSec * 1000, 5_000)
        : 250 * 2 ** (attempt - 1) + Math.random() * 250
      await sleep(backoff)
    } catch (error) {
      upstreamLatencyMs += Date.now() - startedAt
      lastStatus = null
      lastReason =
        error instanceof Error && error.name === "AbortError" ? "timeout" : "fetch_error"
      if (ctx.signal?.aborted || attempt >= maxAttempts) {
        return { kind: "error", status: null, reason: lastReason, upstreamLatencyMs }
      }
      await sleep(250 * 2 ** (attempt - 1) + Math.random() * 250)
    } finally {
      clearTimeout(timer)
      unlinkAbortSignal()
    }
  }

  return { kind: "error", status: lastStatus, reason: lastReason, upstreamLatencyMs }
}

function computeContentHash(args: {
  title: string
  applyUrl: string
  location: string | undefined
  postedAt: string | undefined
  description: string | undefined
}): string {
  return hashContent([
    args.title,
    args.applyUrl,
    args.location,
    args.postedAt,
    args.description?.slice(0, 4_000),
  ])
}

function mapRawJob(parsed: ParsedSlug, raw: WorkdayPosting): (HarvestedJob & { externalPath: string | undefined }) | null {
  if (!raw.title) return null

  const title = raw.title.trim()
  if (!title) return null

  const applyUrl = applyUrlFor(parsed, raw.externalPath)
  const externalId = externalIdFor(raw.externalPath, title)
  const location = pickLocation(raw)
  const postedAt = parseWorkdayPostedOn(raw.postedOn)
  const description = raw.bulletFields?.filter(Boolean).join("\n").trim() || undefined

  return {
    externalId,
    title,
    applyUrl,
    description,
    location,
    postedAt,
    contentHash: computeContentHash({ title, applyUrl, location, postedAt, description }),
    externalPath: raw.externalPath,
  }
}

/**
 * Enrich already-mapped jobs with per-job detail descriptions. Mutates the
 * passed array in place. Capped by DETAIL_MAX_JOBS and DETAIL_CONCURRENCY.
 * Falls back to the listing's bulletFields on any per-job failure.
 */
async function enrichWithDetail(
  parsed: ParsedSlug,
  jobs: Array<HarvestedJob & { externalPath: string | undefined }>,
  ctx: HarvestCtx,
  deadline: number
): Promise<void> {
  if (DETAIL_MAX_JOBS === 0) return
  // Skip jobs that already have a real description in the DB — the cap
  // budget goes to jobs that still need one. After the cap budget is used
  // up, any leftover detail fetches happen on the next harvest cycle.
  const alreadyDescribed = ctx.alreadyDescribedIds
  const targets = jobs
    .filter((j) => Boolean(j.externalPath))
    .filter((j) => !alreadyDescribed?.has(j.externalId))
    .slice(0, DETAIL_MAX_JOBS)
  if (targets.length === 0) return

  const limit = pLimit(DETAIL_CONCURRENCY)
  await Promise.all(
    targets.map((job) =>
      limit(async () => {
        // Once the per-company budget is spent, drop the remaining queued
        // detail fetches so the detail phase can't run unbounded past it.
        if (Date.now() > deadline) return
        const detail = await fetchWorkdayJobDetail(parsed, job.externalPath!, ctx)
        if (!detail) return
        if (detail.description && detail.description.length > (job.description?.length ?? 0)) {
          job.description = detail.description
        }
        if (detail.location && !job.location) {
          job.location = detail.location
        }
        // Recompute content_hash with the richer payload so persist-bulk's
        // IS-DISTINCT-FROM check fires and writes the new description.
        job.contentHash = computeContentHash({
          title: job.title,
          applyUrl: job.applyUrl,
          location: job.location,
          postedAt: job.postedAt,
          description: job.description,
        })
      })
    )
  )
}

/**
 * Choose the best facet to subdivide a capped query on. Skips facets already
 * applied (re-applying just hits the cap again) and single-value facets. Tries
 * the priority list first, then falls back to the highest-cardinality facet
 * (typically the multi-tag skills facet — its counts oversum the total, but each
 * query still returns a valid subset and dedup absorbs the overlap).
 */
function pickFacet(
  facets: WorkdayFacet[],
  alreadyApplied: Set<string>
): [string, string[]] | null {
  const byParam = new Map<string, string[]>()
  for (const facet of facets) {
    const param = facet.facetParameter
    const values = facet.values ?? []
    if (!param || alreadyApplied.has(param) || values.length < 2) continue
    const ids = values
      .filter((v) => v.id && (v.count ?? 0) > 0)
      .map((v) => v.id as string)
    if (ids.length >= 2) byParam.set(param, ids)
  }
  for (const preferred of SUBDIVISION_FACETS) {
    const ids = byParam.get(preferred)
    if (ids) return [preferred, ids]
  }
  let best: [string, string[]] | null = null
  for (const [param, ids] of byParam) {
    if (!best || ids.length > best[1].length) best = [param, ids]
  }
  return best
}

type MappedJob = HarvestedJob & { externalPath: string | undefined }

/**
 * Fully harvest a tenant's listing, subdividing by facet when a query hits the
 * 2,000 cap. Bounded by `deadline` (wall-clock) and MAX_TOTAL_PAGES (request
 * budget); on either bound it returns a partial set. Only the very first POST
 * throws (so the worker's WAF / circuit-breaker logic still sees page-1
 * failures); every later failure degrades to a partial harvest.
 */
async function harvestListing(
  parsed: ParsedSlug,
  url: string,
  ctx: HarvestCtx,
  deadline: number
): Promise<{ jobs: MappedJob[]; upstreamLatencyMs: number }> {
  const limit = pLimit(LISTING_CONCURRENCY)
  const seen = new Set<string>()
  const jobs: MappedJob[] = []
  let pagesUsed = 0
  let upstreamLatencyMs = 0
  let firstPage = true

  const absorb = (postings: WorkdayPosting[]) => {
    for (const raw of postings) {
      const mapped = mapRawJob(parsed, raw)
      if (!mapped) continue
      if (seen.has(mapped.externalId)) continue
      seen.add(mapped.externalId)
      jobs.push(mapped)
    }
  }

  const overBudget = () => Date.now() > deadline || pagesUsed >= MAX_TOTAL_PAGES

  // One listing POST. Wrapping ONLY the network call in the limiter (never the
  // recursion) avoids the classic nested-pLimit deadlock. Returns null on any
  // non-first error or when the budget is spent.
  async function doPost(
    appliedFacets: Record<string, string[]>,
    offset: number
  ): Promise<WorkdayListingResponse | null> {
    if (overBudget()) return null
    pagesUsed += 1
    const result = await limit(() =>
      postWorkdayListing(url, { appliedFacets, limit: PAGE_LIMIT, offset, searchText: "" }, ctx)
    )
    upstreamLatencyMs += result.upstreamLatencyMs
    if (result.kind === "error") {
      if (firstPage) {
        firstPage = false
        const err = new Error(`workday fetch failed: ${result.reason}`)
        ;(err as Error & { status?: number | null }).status = result.status
        throw err
      }
      return null
    }
    firstPage = false
    return result.data
  }

  // Fan out pages [PAGE_LIMIT, min(total, cap)) concurrently.
  async function fanOutPages(appliedFacets: Record<string, string[]>, total: number) {
    const ceiling = Math.min(total, QUERY_TOTAL_CAP)
    const offsets: number[] = []
    for (let o = PAGE_LIMIT; o < ceiling; o += PAGE_LIMIT) offsets.push(o)
    await Promise.all(
      offsets.map(async (o) => {
        const data = await doPost(appliedFacets, o)
        if (data?.jobPostings) absorb(data.jobPostings)
      })
    )
  }

  async function exhaust(appliedFacets: Record<string, string[]>, depth: number): Promise<void> {
    if (overBudget()) return
    const first = await doPost(appliedFacets, 0)
    if (!first) return
    const total = first.total ?? 0
    absorb(first.jobPostings ?? [])
    if (total <= PAGE_LIMIT) return

    // Below the cap → paginate normally, no subdivision needed.
    if (total < QUERY_TOTAL_CAP) {
      await fanOutPages(appliedFacets, total)
      return
    }

    // At the cap → try to subdivide by an unused facet.
    if (depth < MAX_SUBDIVISION_DEPTH) {
      const facet = pickFacet(first.facets ?? [], new Set(Object.keys(appliedFacets)))
      if (facet) {
        const [param, values] = facet
        await Promise.all(
          values.map((valueId) => exhaust({ ...appliedFacets, [param]: [valueId] }, depth + 1))
        )
        return
      }
    }

    // Capped but no facet left (or max depth) → take the capped 2,000.
    await fanOutPages(appliedFacets, QUERY_TOTAL_CAP)
  }

  await exhaust({}, 0)
  return { jobs, upstreamLatencyMs }
}

export const workdayAdapter: AtsAdapter = {
  name: "workday",
  // Each tenant is its own host + slow paginated POSTs (30-60s per board).
  // Per-process limit; with N replicas the cluster total is N×this. Halved
  // from 4 → 2 so 2 workers stay at the original 4-concurrent cluster budget.
  concurrency: envConcurrency("workday", 2),
  detectFromUrl,
  async fetchJobs({ slug, ctx }): Promise<HarvestResult> {
    const fetchedAt = new Date()
    const parsed = parseSlug(slug)
    if (!parsed) {
      throw new Error(`workday: invalid slug "${slug}"`)
    }

    const url = listingUrl(parsed)
    const deadline = Date.now() + COMPANY_DEADLINE_MS

    // Change-check before the full (30-60s) paginated crawl. One page-0 POST
    // fingerprints the board via `total` (catches any add/remove) plus a hash of
    // the first page's job IDs (catches same-count churn in the newest slice). If
    // it matches the stored fingerprint (ctx.etag), the board is unchanged and we
    // skip all pagination + per-job detail. Only trusted BELOW the 2,000 query
    // cap: at/over the cap `total` saturates at 2,000 and deep changes wouldn't
    // move the first page, so capped tenants always take the full facet crawl.
    let fingerprint: string | null = null
    const probe = await postWorkdayListing(
      url,
      { appliedFacets: {}, limit: PAGE_LIMIT, offset: 0, searchText: "" },
      ctx
    )
    if (probe.kind === "ok") {
      const total = probe.data.total ?? 0
      const firstIds = (probe.data.jobPostings ?? [])
        .map((raw) => mapRawJob(parsed, raw)?.externalId)
        .filter((id): id is string => Boolean(id))
      fingerprint = `wdv1:${total}:${hashContent(firstIds)}`
      if (ctx.etag && ctx.etag === fingerprint && total < QUERY_TOTAL_CAP) {
        return {
          jobs: [],
          notModified: true,
          etag: fingerprint,
          lastModified: null,
          sourceAts: "workday",
          sourceAtsSlug: slug,
          fetchedAt,
          upstreamLatencyMs: probe.upstreamLatencyMs,
        }
      }
    }
    // probe error → fall through; harvestListing re-fetches page 0 and throws on
    // a first-page failure, preserving the WAF / circuit-breaker signal.

    // Phase 1: harvest the listing, subdividing by facet on capped tenants so we
    // break past the 2,000-per-query wrap. Bounded by the deadline + page budget;
    // the first page's failure still throws (WAF / circuit-breaker signal).
    const listing = await harvestListing(parsed, url, ctx, deadline)
    const jobs = listing.jobs
    let upstreamLatencyMs = listing.upstreamLatencyMs

    // Phase 2: fetch per-job detail to populate full descriptions. The
    // listing-only `bulletFields` is too sparse for matching/skills
    // extraction. Capped at DETAIL_MAX_JOBS per board, DETAIL_CONCURRENCY
    // parallel — env-tunable for operators tuning throughput vs richness.
    // Per-job detail phase. It self-limits against the same deadline: any
    // fetches still queued when the budget runs out are dropped, so a slow
    // tenant can't run detail unbounded past the per-company budget. Listing
    // (titles, locations, apply URLs) is already captured above either way.
    const detailStart = Date.now()
    await enrichWithDetail(parsed, jobs, ctx, deadline)
    upstreamLatencyMs += Date.now() - detailStart

    return {
      jobs,
      notModified: false,
      // Store the page-0 fingerprint (see change-check above) so the next crawl
      // can skip an unchanged board. Workday CXS doesn't honor If-None-Match on
      // POST, so this app-level fingerprint stands in for an HTTP etag.
      etag: fingerprint,
      lastModified: null,
      sourceAts: "workday",
      sourceAtsSlug: slug,
      fetchedAt,
      upstreamLatencyMs,
    }
  },
}
