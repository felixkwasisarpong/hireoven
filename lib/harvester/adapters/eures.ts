import {
  envConcurrency,
  hashContent,
  type AtsAdapter,
  type HarvestCtx,
  type HarvestResult,
  type HarvestedJob,
} from "@/lib/harvester/adapters/_base"

/**
 * EURES (European Job Mobility Portal) aggregator adapter.
 *
 * EURES is the EU-wide public job-mobility portal operated by the European
 * Labour Authority. It aggregates vacancies from the national public
 * employment services of every EU/EEA member state. We treat each search
 * facet (a sector code, occupation token or country/region) as a separate
 * "company"; the tenant slug is that facet token.
 *
 * The seed/discovery channel creates one company per facet with a synthetic
 * careers URL of the form
 *   https://eures.europa.eu/search?q=<slug>
 * which detectFromUrl() round-trips back to the slug.
 *
 * API surface
 * -----------
 *   GET {EURES_API_BASE}{EURES_JOBS_PATH}
 *   default: GET https://eures.europa.eu/api/jobs/search?q=<slug>&page=<N>
 * with Accept: application/json. Pagination is 1-indexed; we stop when a page
 * returns fewer than the page size, repeats, or the reported total is met.
 *
 * !!! VERIFY LIVE ENDPOINT before enabling in the harvest rotation !!!
 * --------------------------------------------------------------------
 * EURES is a JavaScript SPA fronting a non-public REST API; the exact base
 * path and field names below are ASSUMED and were NOT verifiable at authoring
 * time. `mapItemToJob` is deliberately defensive (multiple fallbacks per
 * field) and the response envelope is read from any of the common keys. Verify
 * against one live facet token before enabling, and override the endpoint with:
 *   EURES_API_BASE   (default https://eures.europa.eu)
 *   EURES_JOBS_PATH  (default /api/jobs/search?q={q}&page={page})
 * All parsing is unit-tested against mocked JSON.
 */

const DEFAULT_API_BASE = "https://eures.europa.eu"
const API_BASE = (process.env.EURES_API_BASE?.trim() || DEFAULT_API_BASE).replace(/\/+$/, "")
// `{q}` and `{page}` placeholders are substituted at request time.
const JOBS_PATH =
  process.env.EURES_JOBS_PATH?.trim() || "/api/jobs/search?q={q}&page={page}"

const RESULTS_PER_PAGE = Math.max(
  10,
  Math.min(100, Number.parseInt(process.env.HARVESTER_EURES_PAGE_SIZE ?? "100", 10))
)
const MAX_PAGES = Math.max(1, Number.parseInt(process.env.HARVESTER_EURES_MAX_PAGES ?? "20", 10))
const DEFAULT_TIMEOUT_MS = 15_000
const RETRY_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504])

const SYNTHETIC_HOST = "eures.europa.eu"
// Facet token: letters / digits / dash / underscore / dot, 1–96 chars.
const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/

function detectFromUrl(url: string): { slug: string } | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.hostname.toLowerCase() !== SYNTHETIC_HOST) return null
  // Accept two synthetic shapes:
  //   /search?q=<slug>       — preferred
  //   /sector/<slug>         — short form used by the seed script
  const q = parsed.searchParams.get("q")
  if (parsed.pathname.toLowerCase() === "/search" && q) {
    const slug = decodeURIComponent(q)
    return SLUG_RE.test(slug) ? { slug } : null
  }
  const parts = parsed.pathname.split("/").filter(Boolean)
  if (parts[0]?.toLowerCase() === "sector" && parts[1]) {
    const slug = decodeURIComponent(parts[1])
    return SLUG_RE.test(slug) ? { slug } : null
  }
  return null
}

function buildJobsUrl(slug: string, page: number): string {
  const path = JOBS_PATH.replace("{q}", encodeURIComponent(slug)).replace("{page}", String(page))
  return `${API_BASE}${path.startsWith("/") ? "" : "/"}${path}`
}

function applyUrlFor(jobId: string): string {
  return `${API_BASE}/jobs/${encodeURIComponent(jobId)}`
}

// ---- Response shapes (defensive; sources vary) -----------------------------

type EuresJob = {
  // id-ish fields, in priority order
  id?: string | number
  jobId?: string | number
  reference?: string | number
  vacancyId?: string | number
  // title
  title?: string
  jobTitle?: string
  name?: string
  // apply / detail url
  applyUrl?: string
  url?: string
  detailUrl?: string
  // description
  description?: string
  summary?: string
  jobDescription?: string
  // location
  location?: string
  locationName?: string
  city?: string
  country?: string
  // salary
  salaryMin?: string | number
  salaryMax?: string | number
  minSalary?: string | number
  maxSalary?: string | number
  currency?: string
  salaryCurrency?: string
  // contract / schedule
  contractType?: string
  employmentType?: string
  jobType?: string
  // dates
  postedAt?: string
  publicationDate?: string
  datePosted?: string
  createdAt?: string
}

type EuresResponse =
  | EuresJob[]
  | {
      data?: EuresJob[]
      results?: EuresJob[]
      items?: EuresJob[]
      jobs?: EuresJob[]
      records?: EuresJob[]
      total?: number
      totalCount?: number
      totalResults?: number
      resultCount?: number
    }

function firstString(...values: Array<string | number | undefined>): string | undefined {
  for (const v of values) {
    if (typeof v === "number" && Number.isFinite(v)) return String(v)
    if (typeof v === "string" && v.trim().length > 0) return v.trim()
  }
  return undefined
}

function toSalary(
  min: string | number | undefined,
  max: string | number | undefined,
  currency: string | undefined
): { min?: number; max?: number; currency?: string } | null {
  const parse = (v: string | number | undefined): number | undefined => {
    if (v === undefined) return undefined
    const n = typeof v === "number" ? v : Number.parseFloat(String(v).replace(/[^0-9.]/g, ""))
    return Number.isFinite(n) ? Math.round(n) : undefined
  }
  const lo = parse(min)
  const hi = parse(max)
  if (lo === undefined && hi === undefined) return null
  return { min: lo, max: hi, currency: currency?.trim() || "EUR" }
}

function locationFor(item: EuresJob): string | undefined {
  const direct = firstString(item.locationName, item.location)
  if (direct) return direct
  const parts = [item.city, item.country].map((p) => p?.trim()).filter((p): p is string => Boolean(p))
  return parts.length ? parts.join(", ") : undefined
}

function extractJobs(data: EuresResponse): { jobs: EuresJob[]; total: number } {
  // total=0 means "unknown" — a bare array carries no count, so pagination must
  // rely on page-size / empty-page signals rather than a satisfied total.
  if (Array.isArray(data)) return { jobs: data, total: 0 }
  const jobs = data.data ?? data.results ?? data.items ?? data.jobs ?? data.records ?? []
  const total = data.total ?? data.totalCount ?? data.totalResults ?? data.resultCount ?? 0
  return { jobs, total }
}

export function mapItemToJob(slug: string, item: EuresJob): HarvestedJob | null {
  const title = firstString(item.title, item.jobTitle, item.name)
  if (!title) return null
  const externalIdRaw = firstString(item.id, item.jobId, item.reference, item.vacancyId)
  if (!externalIdRaw) return null

  const applyUrl = firstString(item.applyUrl, item.url, item.detailUrl) ?? applyUrlFor(externalIdRaw)
  const description = firstString(item.description, item.summary, item.jobDescription)
  const location = locationFor(item)
  const employmentType = firstString(item.contractType, item.employmentType, item.jobType)
  const postedRaw = firstString(item.postedAt, item.publicationDate, item.datePosted, item.createdAt)
  let postedAt: string | undefined
  if (postedRaw) {
    const d = new Date(postedRaw)
    if (!Number.isNaN(d.getTime())) postedAt = d.toISOString()
  }
  const salary = toSalary(
    item.salaryMin ?? item.minSalary,
    item.salaryMax ?? item.maxSalary,
    item.currency ?? item.salaryCurrency
  )

  return {
    externalId: `eures:${slug}:${externalIdRaw}`,
    title,
    applyUrl,
    description,
    location,
    postedAt,
    employmentType,
    salaryMin: salary?.min,
    salaryMax: salary?.max,
    salaryCurrency: salary?.currency,
    contentHash: hashContent([
      title,
      applyUrl,
      location,
      postedAt,
      employmentType,
      salary?.min,
      salary?.max,
      salary?.currency,
      description?.slice(0, 4_000),
    ]),
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchPage(
  url: string,
  ctx: HarvestCtx
): Promise<
  | { ok: true; data: EuresResponse; upstreamLatencyMs: number }
  | { ok: false; status: number | null; reason: string; upstreamLatencyMs: number }
> {
  const doFetch = ctx.fetchImpl ?? fetch
  const timeoutMs = Math.max(2_000, ctx.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  let attempt = 0
  let upstreamLatencyMs = 0
  let lastStatus: number | null = null
  let lastReason = "unknown"

  while (attempt < 3) {
    attempt += 1
    const startedAt = Date.now()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await doFetch(url, {
        method: "GET",
        headers: {
          accept: "application/json",
          "user-agent":
            ctx.userAgent ?? "hireoven-harvester/1.0 (+https://hireoven.com; bot@hireoven.com)",
        },
        signal: controller.signal,
      })
      upstreamLatencyMs += Date.now() - startedAt
      if (response.ok) {
        const data = (await response.json()) as EuresResponse
        return { ok: true, data, upstreamLatencyMs }
      }
      lastStatus = response.status
      lastReason = `http_${response.status}`
      if (!RETRY_STATUSES.has(response.status) || attempt >= 3) {
        return { ok: false, status: response.status, reason: lastReason, upstreamLatencyMs }
      }
      await sleep(500 * 2 ** (attempt - 1) + Math.random() * 250)
    } catch (error) {
      upstreamLatencyMs += Date.now() - startedAt
      lastReason = error instanceof Error && error.name === "AbortError" ? "timeout" : "fetch_error"
      if (attempt >= 3) {
        return { ok: false, status: null, reason: lastReason, upstreamLatencyMs }
      }
      await sleep(500 * 2 ** (attempt - 1) + Math.random() * 250)
    } finally {
      clearTimeout(timer)
    }
  }
  return { ok: false, status: lastStatus, reason: lastReason, upstreamLatencyMs }
}

export const euresAdapter: AtsAdapter = {
  name: "eures" as AtsAdapter["name"],
  // One central API host (eures.europa.eu) shared by every facet — keep the
  // per-process budget modest so co-scheduled facets don't hammer it.
  concurrency: envConcurrency("eures" as AtsAdapter["name"], 2),
  detectFromUrl,
  async fetchJobs({ slug, ctx }): Promise<HarvestResult> {
    const fetchedAt = new Date()
    const startedAt = Date.now()
    if (!SLUG_RE.test(slug)) throw new Error(`eures malformed slug: ${slug}`)

    const jobs = new Map<string, HarvestedJob>()
    let latencyMs = 0
    let pagesFetched = 0
    let totalReported = 0

    for (let page = 1; page <= MAX_PAGES; page++) {
      const url = buildJobsUrl(slug, page)
      const result = await fetchPage(url, ctx)
      if (!result.ok) {
        if (page === 1) {
          const err = new Error(`eures fetch failed: ${result.reason}`)
          ;(err as Error & { status?: number | null }).status = result.status
          throw err
        }
        break
      }
      pagesFetched += 1
      latencyMs += result.upstreamLatencyMs
      const { jobs: items, total } = extractJobs(result.data)
      totalReported = total || totalReported
      let added = 0
      for (const item of items) {
        const job = mapItemToJob(slug, item)
        if (!job) continue
        if (jobs.has(job.externalId)) continue
        jobs.set(job.externalId, job)
        added += 1
      }
      if (items.length < RESULTS_PER_PAGE) break
      if (added === 0) break
      if (totalReported && jobs.size >= totalReported) break
    }

    if (pagesFetched === 0) {
      const err = new Error("eures fetch failed: no pages fetched")
      ;(err as Error & { status?: number | null }).status = null
      throw err
    }

    return {
      jobs: Array.from(jobs.values()),
      notModified: false,
      etag: null,
      lastModified: null,
      sourceAts: "eures" as HarvestResult["sourceAts"],
      sourceAtsSlug: slug,
      fetchedAt,
      upstreamLatencyMs: Math.max(latencyMs, Date.now() - startedAt),
    }
  },
}

export { buildJobsUrl, detectFromUrl }
