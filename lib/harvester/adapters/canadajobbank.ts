import {
  envConcurrency,
  hashContent,
  type AtsAdapter,
  type HarvestCtx,
  type HarvestResult,
  type HarvestedJob,
} from "@/lib/harvester/adapters/_base"

/**
 * Canada Job Bank aggregator adapter.
 *
 * Job Bank (jobbank.gc.ca) is the Government of Canada / ESDC national job
 * board. We treat each search facet (a keyword, NOC code, sector or province
 * token) as a separate "company"; the tenant slug is that facet token.
 *
 * The seed/discovery channel creates one company per facet with a synthetic
 * careers URL of the form
 *   https://www.jobbank.gc.ca/jobsearch?q=<slug>
 * which detectFromUrl() round-trips back to the slug.
 *
 * API surface
 * -----------
 *   GET {CANADAJOBBANK_API_BASE}{CANADAJOBBANK_JOBS_PATH}
 *   default: GET https://www.jobbank.gc.ca/api/jobsearch?q=<slug>&page=<N>
 * with Accept: application/json. Pagination is 1-indexed; we stop when a page
 * returns fewer than the page size, repeats, or the reported total is met.
 *
 * !!! VERIFY LIVE ENDPOINT before enabling in the harvest rotation !!!
 * --------------------------------------------------------------------
 * Job Bank serves results through a server-rendered search UI without a
 * documented public JSON API; the base path and field names below are ASSUMED
 * and were NOT verifiable at authoring time. `mapItemToJob` is deliberately
 * defensive (multiple fallbacks per field) and the response envelope is read
 * from any of the common keys. Verify against one live facet token before
 * enabling, and override the endpoint with:
 *   CANADAJOBBANK_API_BASE   (default https://www.jobbank.gc.ca)
 *   CANADAJOBBANK_JOBS_PATH  (default /api/jobsearch?q={q}&page={page})
 * All parsing is unit-tested against mocked JSON.
 */

const DEFAULT_API_BASE = "https://www.jobbank.gc.ca"
const API_BASE = (process.env.CANADAJOBBANK_API_BASE?.trim() || DEFAULT_API_BASE).replace(
  /\/+$/,
  ""
)
// `{q}` and `{page}` placeholders are substituted at request time.
const JOBS_PATH =
  process.env.CANADAJOBBANK_JOBS_PATH?.trim() || "/api/jobsearch?q={q}&page={page}"

const RESULTS_PER_PAGE = Math.max(
  10,
  Math.min(100, Number.parseInt(process.env.HARVESTER_CANADAJOBBANK_PAGE_SIZE ?? "25", 10))
)
const MAX_PAGES = Math.max(
  1,
  Number.parseInt(process.env.HARVESTER_CANADAJOBBANK_MAX_PAGES ?? "20", 10)
)
const DEFAULT_TIMEOUT_MS = 15_000
const RETRY_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504])

const SYNTHETIC_HOST = "www.jobbank.gc.ca"
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
  //   /jobsearch?q=<slug>   — preferred
  //   /sector/<slug>        — short form used by the seed script
  const q = parsed.searchParams.get("q")
  if (parsed.pathname.toLowerCase() === "/jobsearch" && q) {
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
  return `${API_BASE}/jobsearch/jobposting/${encodeURIComponent(jobId)}`
}

// ---- Response shapes (defensive; sources vary) -----------------------------

type JobBankJob = {
  // id-ish fields, in priority order
  id?: string | number
  jobId?: string | number
  reference?: string | number
  jobOrderId?: string | number
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
  province?: string
  // salary
  salaryMin?: string | number
  salaryMax?: string | number
  minSalary?: string | number
  maxSalary?: string | number
  wage?: string | number
  currency?: string
  salaryCurrency?: string
  // contract / schedule
  contractType?: string
  employmentType?: string
  jobType?: string
  terms?: string
  // dates
  postedAt?: string
  datePosted?: string
  postingDate?: string
  createdAt?: string
}

type JobBankResponse =
  | JobBankJob[]
  | {
      data?: JobBankJob[]
      results?: JobBankJob[]
      items?: JobBankJob[]
      jobs?: JobBankJob[]
      records?: JobBankJob[]
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
  return { min: lo, max: hi, currency: currency?.trim() || "CAD" }
}

function locationFor(item: JobBankJob): string | undefined {
  const direct = firstString(item.locationName, item.location)
  if (direct) return direct
  const parts = [item.city, item.province].map((p) => p?.trim()).filter((p): p is string => Boolean(p))
  return parts.length ? parts.join(", ") : undefined
}

function extractJobs(data: JobBankResponse): { jobs: JobBankJob[]; total: number } {
  // total=0 means "unknown" — a bare array carries no count, so pagination must
  // rely on page-size / empty-page signals rather than a satisfied total.
  if (Array.isArray(data)) return { jobs: data, total: 0 }
  const jobs = data.data ?? data.results ?? data.items ?? data.jobs ?? data.records ?? []
  const total = data.total ?? data.totalCount ?? data.totalResults ?? data.resultCount ?? 0
  return { jobs, total }
}

export function mapItemToJob(slug: string, item: JobBankJob): HarvestedJob | null {
  const title = firstString(item.title, item.jobTitle, item.name)
  if (!title) return null
  const externalIdRaw = firstString(item.id, item.jobId, item.reference, item.jobOrderId)
  if (!externalIdRaw) return null

  const applyUrl = firstString(item.applyUrl, item.url, item.detailUrl) ?? applyUrlFor(externalIdRaw)
  const description = firstString(item.description, item.summary, item.jobDescription)
  const location = locationFor(item)
  const employmentType = firstString(item.contractType, item.employmentType, item.jobType, item.terms)
  const postedRaw = firstString(item.postedAt, item.datePosted, item.postingDate, item.createdAt)
  let postedAt: string | undefined
  if (postedRaw) {
    const d = new Date(postedRaw)
    if (!Number.isNaN(d.getTime())) postedAt = d.toISOString()
  }
  const salary = toSalary(
    item.salaryMin ?? item.minSalary ?? item.wage,
    item.salaryMax ?? item.maxSalary,
    item.currency ?? item.salaryCurrency
  )

  return {
    externalId: `canadajobbank:${slug}:${externalIdRaw}`,
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
  | { ok: true; data: JobBankResponse; upstreamLatencyMs: number }
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
        const data = (await response.json()) as JobBankResponse
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

export const canadajobbankAdapter: AtsAdapter = {
  name: "canadajobbank" as AtsAdapter["name"],
  // One central API host (jobbank.gc.ca) shared by every facet — keep the
  // per-process budget modest so co-scheduled facets don't hammer it.
  concurrency: envConcurrency("canadajobbank" as AtsAdapter["name"], 2),
  detectFromUrl,
  async fetchJobs({ slug, ctx }): Promise<HarvestResult> {
    const fetchedAt = new Date()
    const startedAt = Date.now()
    if (!SLUG_RE.test(slug)) throw new Error(`canadajobbank malformed slug: ${slug}`)

    const jobs = new Map<string, HarvestedJob>()
    let latencyMs = 0
    let pagesFetched = 0
    let totalReported = 0

    for (let page = 1; page <= MAX_PAGES; page++) {
      const url = buildJobsUrl(slug, page)
      const result = await fetchPage(url, ctx)
      if (!result.ok) {
        if (page === 1) {
          const err = new Error(`canadajobbank fetch failed: ${result.reason}`)
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
      const err = new Error("canadajobbank fetch failed: no pages fetched")
      ;(err as Error & { status?: number | null }).status = null
      throw err
    }

    return {
      jobs: Array.from(jobs.values()),
      notModified: false,
      etag: null,
      lastModified: null,
      sourceAts: "canadajobbank" as HarvestResult["sourceAts"],
      sourceAtsSlug: slug,
      fetchedAt,
      upstreamLatencyMs: Math.max(latencyMs, Date.now() - startedAt),
    }
  },
}

export { buildJobsUrl, detectFromUrl }
