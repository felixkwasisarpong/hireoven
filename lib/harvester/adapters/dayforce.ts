import {
  envConcurrency,
  hashContent,
  type AtsAdapter,
  type HarvestCtx,
  type HarvestResult,
  type HarvestedJob,
} from "@/lib/harvester/adapters/_base"

/**
 * Dayforce adapter (Ceridian Dayforce candidate portal).
 *
 * Ceridian Dayforce powers branded candidate-portal career pages. Each customer
 * is a separate "company"; the tenant slug is the client name token that appears
 * in the Dayforce candidate-portal path, e.g.
 *   https://us.dayforcehcm.com/CandidatePortal/en-US/acmecorp/
 *   https://us.dayforcehcm.com/CandidatePortal/en-US/acmecorp/Posting/View/123
 * detectFromUrl() round-trips that token back to the slug.
 *
 * ┌────────────────────────────────────────────────────────────────────────┐
 * │ VERIFY LIVE ENDPOINT before enabling in harvest rotation.                │
 * │ Dayforce's public listing JSON shape is NOT verified here. The field     │
 * │ names below are best-effort and read defensively (multiple fallbacks per │
 * │ field, envelope read from any common key). Confirm against one live      │
 * │ company token and set DAYFORCE_API_BASE / DAYFORCE_JOBS_PATH if a tenant │
 * │ deviates. All parsing is unit-tested against mocked JSON only.           │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * API surface (defaults, overridable):
 *   GET {DAYFORCE_API_BASE}/api/{company}/v1/JobPosting?page={page}
 */

const DEFAULT_API_BASE = "https://us.dayforcehcm.com"
const API_BASE = (process.env.DAYFORCE_API_BASE?.trim() || DEFAULT_API_BASE).replace(/\/+$/, "")
const JOBS_PATH =
  process.env.DAYFORCE_JOBS_PATH?.trim() || "/api/{company}/v1/JobPosting?page={page}"

const RESULTS_PER_PAGE = Math.max(
  10,
  Math.min(200, Number.parseInt(process.env.HARVESTER_DAYFORCE_PAGE_SIZE ?? "100", 10))
)
const MAX_PAGES = Math.max(
  1,
  Number.parseInt(process.env.HARVESTER_DAYFORCE_MAX_PAGES ?? "20", 10)
)
const DEFAULT_TIMEOUT_MS = 15_000
const RETRY_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504])

const DAYFORCE_HOST_RE = /(^|\.)dayforcehcm\.com$/
// Client name token: letters / digits / dot / dash / underscore, 2–64 chars.
const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$/

function detectFromUrl(url: string): { slug: string } | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  const host = parsed.hostname.toLowerCase()
  if (!DAYFORCE_HOST_RE.test(host)) return null
  const parts = parsed.pathname.split("/").filter(Boolean)
  // .../CandidatePortal/<locale>/<clientname>/...  — slug is two tokens after
  // "candidateportal" (skipping the locale token like en-US).
  const i = parts.findIndex((p) => p.toLowerCase() === "candidateportal")
  if (i === -1) return null
  const candidate = parts[i + 2]
  if (candidate) {
    const slug = decodeURIComponent(candidate)
    if (SLUG_RE.test(slug)) return { slug }
  }
  const fallback = parts[i + 1]
  if (fallback) {
    const slug = decodeURIComponent(fallback)
    if (SLUG_RE.test(slug)) return { slug }
  }
  return null
}

function buildJobsUrl(slug: string, page = 1): string {
  const path = JOBS_PATH.replace("{company}", encodeURIComponent(slug)).replace(
    "{page}",
    String(page)
  )
  return `${API_BASE}${path.startsWith("/") ? "" : "/"}${path}`
}

function applyUrlFor(slug: string, jobId: string): string {
  return `${API_BASE}/CandidatePortal/en-US/${encodeURIComponent(slug)}/Posting/View/${encodeURIComponent(jobId)}`
}

// ---- Response shapes (defensive; tenants vary) -----------------------------

type DayforceJob = {
  id?: string | number
  jobId?: string | number
  positionId?: string | number
  requisitionId?: string | number
  title?: string
  jobTitle?: string
  name?: string
  positionTitle?: string
  description?: string
  jobDescription?: string
  summary?: string
  applyUrl?: string
  url?: string
  applicationUrl?: string
  location?: string
  city?: string
  locationName?: string
  employmentType?: string
  jobType?: string
  type?: string
  postedAt?: string
  publishedAt?: string
  createdAt?: string
  salaryMin?: string | number
  payMin?: string | number
  salaryMax?: string | number
  payMax?: string | number
  salaryCurrency?: string
  currency?: string
}

type DayforceResponse =
  | DayforceJob[]
  | {
      data?: DayforceJob[]
      results?: DayforceJob[]
      items?: DayforceJob[]
      jobs?: DayforceJob[]
      positions?: DayforceJob[]
      postings?: DayforceJob[]
      opportunities?: DayforceJob[]
      total?: number
      totalCount?: number
      count?: number
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
    const n = typeof v === "number" ? v : Number.parseFloat(String(v).replace(/[$,]/g, ""))
    return Number.isFinite(n) ? Math.round(n) : undefined
  }
  const lo = parse(min)
  const hi = parse(max)
  if (lo === undefined && hi === undefined) return null
  return { min: lo, max: hi, currency: currency?.trim() || "USD" }
}

function extractJobs(data: DayforceResponse): { jobs: DayforceJob[]; total: number } {
  // total=0 means "unknown" — a bare array carries no count, so pagination must
  // rely on page-size / empty-page signals rather than a satisfied total.
  if (Array.isArray(data)) return { jobs: data, total: 0 }
  const jobs =
    data.data ??
    data.results ??
    data.items ??
    data.jobs ??
    data.positions ??
    data.postings ??
    data.opportunities ??
    []
  const total = data.total ?? data.totalCount ?? data.count ?? 0
  return { jobs, total }
}

export function mapItemToJob(slug: string, item: DayforceJob): HarvestedJob | null {
  const title = firstString(item.title, item.jobTitle, item.name, item.positionTitle)
  if (!title) return null
  const externalIdRaw = firstString(
    item.id,
    item.jobId,
    item.positionId,
    item.requisitionId
  )
  if (!externalIdRaw) return null

  const applyUrl =
    firstString(item.applyUrl, item.applicationUrl, item.url) ??
    applyUrlFor(slug, externalIdRaw)
  const description = firstString(item.description, item.jobDescription, item.summary)
  const location = firstString(item.locationName, item.location, item.city)
  const employmentType = firstString(item.employmentType, item.jobType, item.type)
  const postedRaw = firstString(item.postedAt, item.publishedAt, item.createdAt)
  let postedAt: string | undefined
  if (postedRaw) {
    const d = new Date(postedRaw)
    if (!Number.isNaN(d.getTime())) postedAt = d.toISOString()
  }
  const salary = toSalary(
    item.salaryMin ?? item.payMin,
    item.salaryMax ?? item.payMax,
    item.salaryCurrency ?? item.currency
  )

  return {
    externalId: `dayforce:${slug}:${externalIdRaw}`,
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
  | { ok: true; data: DayforceResponse; upstreamLatencyMs: number }
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
            ctx.userAgent ??
            "hireoven-harvester/1.0 (+https://hireoven.com; bot@hireoven.com)",
        },
        signal: controller.signal,
      })
      upstreamLatencyMs += Date.now() - startedAt
      if (response.ok) {
        const data = (await response.json()) as DayforceResponse
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
      lastReason =
        error instanceof Error && error.name === "AbortError" ? "timeout" : "fetch_error"
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

export const dayforceAdapter: AtsAdapter = {
  name: "dayforce",
  concurrency: envConcurrency("dayforce", 3),
  detectFromUrl,
  async fetchJobs({ slug, ctx }): Promise<HarvestResult> {
    const fetchedAt = new Date()
    const startedAt = Date.now()
    if (!SLUG_RE.test(slug)) throw new Error(`dayforce malformed slug: ${slug}`)

    const jobs = new Map<string, HarvestedJob>()
    let latencyMs = 0
    let pagesFetched = 0
    let totalReported = 0

    for (let page = 1; page <= MAX_PAGES; page++) {
      const url = buildJobsUrl(slug, page)
      const result = await fetchPage(url, ctx)
      if (!result.ok) {
        if (page === 1) {
          const err = new Error(`dayforce fetch failed: ${result.reason}`)
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
      const err = new Error("dayforce fetch failed: no pages fetched")
      ;(err as Error & { status?: number | null }).status = null
      throw err
    }

    return {
      jobs: Array.from(jobs.values()),
      notModified: false,
      etag: null,
      lastModified: null,
      sourceAts: "dayforce",
      sourceAtsSlug: slug,
      fetchedAt,
      upstreamLatencyMs: Math.max(latencyMs, Date.now() - startedAt),
    }
  },
}

export { buildJobsUrl, detectFromUrl }
