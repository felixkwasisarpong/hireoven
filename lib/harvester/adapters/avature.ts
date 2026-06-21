import {
  envConcurrency,
  hashContent,
  type AtsAdapter,
  type HarvestCtx,
  type HarvestResult,
  type HarvestedJob,
} from "@/lib/harvester/adapters/_base"

/**
 * Avature adapter (enterprise CRM-style ATS).
 *
 * Avature powers branded enterprise career portals. Each customer gets a
 * dedicated subdomain on avature.net; the tenant slug is the subdomain label
 * that appears in the Avature careers host, e.g.
 *   https://acme.avature.net/careers
 * detectFromUrl() round-trips that subdomain label back to the slug.
 *
 * ┌────────────────────────────────────────────────────────────────────────┐
 * │ VERIFY LIVE ENDPOINT before enabling in harvest rotation.                │
 * │ Avature's public listing JSON shape is NOT verified here. The field      │
 * │ names below are best-effort and read defensively (multiple fallbacks per │
 * │ field, envelope read from any common key). Confirm against one live      │
 * │ company token and set AVATURE_API_BASE / AVATURE_JOBS_PATH if a tenant   │
 * │ deviates. All parsing is unit-tested against mocked JSON only.           │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * API surface (defaults, overridable):
 *   GET {AVATURE_API_BASE}/careers/SearchJobs?jsonp=false&page={page}
 *   (AVATURE_API_BASE templates the per-company subdomain via {company})
 */

const DEFAULT_API_BASE = "https://{company}.avature.net"
const API_BASE = (process.env.AVATURE_API_BASE?.trim() || DEFAULT_API_BASE).replace(/\/+$/, "")
const JOBS_PATH =
  process.env.AVATURE_JOBS_PATH?.trim() || "/careers/SearchJobs?jsonp=false&page={page}"

const RESULTS_PER_PAGE = Math.max(
  10,
  Math.min(200, Number.parseInt(process.env.HARVESTER_AVATURE_PAGE_SIZE ?? "100", 10))
)
const MAX_PAGES = Math.max(
  1,
  Number.parseInt(process.env.HARVESTER_AVATURE_MAX_PAGES ?? "20", 10)
)
const DEFAULT_TIMEOUT_MS = 15_000
const RETRY_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504])

const AVATURE_HOST_RE = /(^|\.)avature\.net$/
// Company token: letters / digits / dash, 2–64 chars.
const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9-]{1,63}$/

function detectFromUrl(url: string): { slug: string } | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  const host = parsed.hostname.toLowerCase()
  if (!AVATURE_HOST_RE.test(host)) return null
  // <company>.avature.net — first subdomain label is the company token.
  const label = host.split(".")[0]
  if (label && label !== "www" && host !== "avature.net") {
    return SLUG_RE.test(label) ? { slug: label } : null
  }
  return null
}

function buildJobsUrl(slug: string, page = 1): string {
  const base = API_BASE.replace("{company}", encodeURIComponent(slug))
  const path = JOBS_PATH.replace("{company}", encodeURIComponent(slug)).replace(
    "{page}",
    String(page)
  )
  return `${base}${path.startsWith("/") ? "" : "/"}${path}`
}

function applyUrlFor(slug: string, jobId: string): string {
  return `https://${encodeURIComponent(slug)}.avature.net/careers/JobDetail/${encodeURIComponent(jobId)}`
}

// ---- Response shapes (defensive; tenants vary) -----------------------------

type AvatureJob = {
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

type AvatureResponse =
  | AvatureJob[]
  | {
      data?: AvatureJob[]
      results?: AvatureJob[]
      items?: AvatureJob[]
      jobs?: AvatureJob[]
      positions?: AvatureJob[]
      postings?: AvatureJob[]
      opportunities?: AvatureJob[]
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

function extractJobs(data: AvatureResponse): { jobs: AvatureJob[]; total: number } {
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

export function mapItemToJob(slug: string, item: AvatureJob): HarvestedJob | null {
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
    externalId: `avature:${slug}:${externalIdRaw}`,
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
  | { ok: true; data: AvatureResponse; upstreamLatencyMs: number }
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
        const data = (await response.json()) as AvatureResponse
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

export const avatureAdapter: AtsAdapter = {
  name: "avature",
  concurrency: envConcurrency("avature", 4),
  detectFromUrl,
  async fetchJobs({ slug, ctx }): Promise<HarvestResult> {
    const fetchedAt = new Date()
    const startedAt = Date.now()
    if (!SLUG_RE.test(slug)) throw new Error(`avature malformed slug: ${slug}`)

    const jobs = new Map<string, HarvestedJob>()
    let latencyMs = 0
    let pagesFetched = 0
    let totalReported = 0

    for (let page = 1; page <= MAX_PAGES; page++) {
      const url = buildJobsUrl(slug, page)
      const result = await fetchPage(url, ctx)
      if (!result.ok) {
        if (page === 1) {
          const err = new Error(`avature fetch failed: ${result.reason}`)
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
      const err = new Error("avature fetch failed: no pages fetched")
      ;(err as Error & { status?: number | null }).status = null
      throw err
    }

    return {
      jobs: Array.from(jobs.values()),
      notModified: false,
      etag: null,
      lastModified: null,
      sourceAts: "avature",
      sourceAtsSlug: slug,
      fetchedAt,
      upstreamLatencyMs: Math.max(latencyMs, Date.now() - startedAt),
    }
  },
}

export { buildJobsUrl, detectFromUrl }
