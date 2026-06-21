import {
  envConcurrency,
  hashContent,
  type AtsAdapter,
  type HarvestCtx,
  type HarvestResult,
  type HarvestedJob,
} from "@/lib/harvester/adapters/_base"

/**
 * NEOGOV / GovernmentJobs.com aggregator adapter.
 *
 * GovernmentJobs.com (a NEOGOV product) is the dominant US public-sector job
 * board. Every agency runs a branded career page at
 *   https://www.governmentjobs.com/careers/<agency>
 * (some agencies use the schooljobs.com sibling host). We treat each agency
 * as a separate "company"; the tenant slug is the `<agency>` path token.
 *
 * The seed/discovery channel creates one company per agency with a careers URL
 * of the form https://www.governmentjobs.com/careers/<agency>, which
 * detectFromUrl() round-trips back to the slug.
 *
 * API surface
 * -----------
 * GovernmentJobs serves a JSON job feed per agency. The default endpoint is
 *   GET {NEOGOV_API_BASE}/careers/<agency>/jobs?page=<N>
 * with Accept: application/json. The host is overridable via NEOGOV_API_BASE
 * because a minority of tenants live on schooljobs.com. Pagination is
 * 1-indexed; we stop when a page returns fewer than the page size, repeats, or
 * the reported total is satisfied.
 *
 * NOTE FOR REVIEWERS: the field NAMES below follow the documented NEOGOV
 * Career Pages job-posting schema, but the public unauthenticated endpoint
 * varies slightly by tenant/version. `mapItemToJob` is deliberately defensive
 * (multiple fallbacks per field) and the response envelope is read from any of
 * the common keys. Verify against one live agency token before enabling in the
 * harvest rotation, and set NEOGOV_API_BASE / NEOGOV_JOBS_PATH if a tenant
 * deviates. All parsing is unit-tested against mocked JSON.
 */

const DEFAULT_API_BASE = "https://www.governmentjobs.com"
const API_BASE = (process.env.NEOGOV_API_BASE?.trim() || DEFAULT_API_BASE).replace(/\/+$/, "")
// `{agency}` and `{page}` placeholders are substituted at request time.
const JOBS_PATH =
  process.env.NEOGOV_JOBS_PATH?.trim() || "/careers/{agency}/jobs?page={page}"

const RESULTS_PER_PAGE = Math.max(
  10,
  Math.min(100, Number.parseInt(process.env.HARVESTER_NEOGOV_PAGE_SIZE ?? "100", 10))
)
const MAX_PAGES = Math.max(
  1,
  Number.parseInt(process.env.HARVESTER_NEOGOV_MAX_PAGES ?? "20", 10)
)
const DEFAULT_TIMEOUT_MS = 15_000
const RETRY_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504])

const CAREERS_HOSTS = new Set(["www.governmentjobs.com", "governmentjobs.com"])
const SCHOOLJOBS_HOSTS = new Set(["www.schooljobs.com", "schooljobs.com"])
// Agency token: letters / digits / dash / underscore, 2–64 chars.
const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/

function detectFromUrl(url: string): { slug: string } | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  const host = parsed.hostname.toLowerCase()
  if (!CAREERS_HOSTS.has(host) && !SCHOOLJOBS_HOSTS.has(host)) return null
  const parts = parsed.pathname.split("/").filter(Boolean)
  // /careers/<agency>[/...]
  if (parts[0]?.toLowerCase() !== "careers" || !parts[1]) return null
  const slug = decodeURIComponent(parts[1])
  return SLUG_RE.test(slug) ? { slug } : null
}

function buildJobsUrl(slug: string, page: number): string {
  const path = JOBS_PATH.replace("{agency}", encodeURIComponent(slug)).replace(
    "{page}",
    String(page)
  )
  return `${API_BASE}${path.startsWith("/") ? "" : "/"}${path}`
}

function applyUrlFor(slug: string, jobId: string): string {
  return `${API_BASE}/careers/${encodeURIComponent(slug)}/jobs/${encodeURIComponent(jobId)}`
}

// ---- Response shapes (defensive; tenants vary) -----------------------------

type NeogovJob = {
  // id-ish fields, in priority order
  Id?: string | number
  JobId?: string | number
  RecruitmentId?: string | number
  JobPostingId?: string | number
  // title
  Title?: string
  JobTitle?: string
  ClassTitle?: string
  // description
  Description?: string
  JobSummary?: string
  Summary?: string
  // location
  Location?: string
  LocationDisplay?: string
  // salary
  SalaryMin?: string | number
  SalaryMax?: string | number
  SalaryRangeMin?: string | number
  SalaryRangeMax?: string | number
  // job type / schedule
  JobType?: string
  EmploymentType?: string
  // dates
  OpenDate?: string
  PostedDate?: string
  PublishDate?: string
}

type NeogovResponse =
  | NeogovJob[]
  | {
      Jobs?: NeogovJob[]
      Items?: NeogovJob[]
      Results?: NeogovJob[]
      Data?: NeogovJob[]
      TotalCount?: number
      Total?: number
      ResultCount?: number
    }

function firstString(...values: Array<string | number | undefined>): string | undefined {
  for (const v of values) {
    if (typeof v === "number" && Number.isFinite(v)) return String(v)
    if (typeof v === "string" && v.trim().length > 0) return v.trim()
  }
  return undefined
}

function toAnnualSalary(
  min: string | number | undefined,
  max: string | number | undefined
): { min?: number; max?: number; currency?: string } | null {
  const parse = (v: string | number | undefined): number | undefined => {
    if (v === undefined) return undefined
    const n = typeof v === "number" ? v : Number.parseFloat(String(v).replace(/[$,]/g, ""))
    return Number.isFinite(n) ? Math.round(n) : undefined
  }
  const lo = parse(min)
  const hi = parse(max)
  if (lo === undefined && hi === undefined) return null
  // Drop obvious hourly figures and nonsense; keep plausible annual ranges.
  if ((lo ?? 0) > 0 && (lo ?? 0) < 10_000) return null
  if ((hi ?? 0) > 2_000_000) return null
  return { min: lo, max: hi, currency: "USD" }
}

function extractJobs(data: NeogovResponse): { jobs: NeogovJob[]; total: number } {
  // total=0 means "unknown" — a bare array carries no count, so pagination must
  // rely on page-size / empty-page signals rather than a satisfied total.
  if (Array.isArray(data)) return { jobs: data, total: 0 }
  const jobs = data.Jobs ?? data.Items ?? data.Results ?? data.Data ?? []
  const total = data.TotalCount ?? data.Total ?? data.ResultCount ?? 0
  return { jobs, total }
}

export function mapItemToJob(slug: string, item: NeogovJob): HarvestedJob | null {
  const title = firstString(item.Title, item.JobTitle, item.ClassTitle)
  if (!title) return null
  const externalIdRaw = firstString(
    item.Id,
    item.JobId,
    item.RecruitmentId,
    item.JobPostingId
  )
  if (!externalIdRaw) return null

  const applyUrl = applyUrlFor(slug, externalIdRaw)
  const description = firstString(item.Description, item.JobSummary, item.Summary)
  const location = firstString(item.LocationDisplay, item.Location)
  const employmentType = firstString(item.JobType, item.EmploymentType)
  const postedRaw = firstString(item.OpenDate, item.PostedDate, item.PublishDate)
  let postedAt: string | undefined
  if (postedRaw) {
    const d = new Date(postedRaw)
    if (!Number.isNaN(d.getTime())) postedAt = d.toISOString()
  }
  const salary = toAnnualSalary(
    item.SalaryMin ?? item.SalaryRangeMin,
    item.SalaryMax ?? item.SalaryRangeMax
  )

  return {
    externalId: `neogov:${slug}:${externalIdRaw}`,
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
  | { ok: true; data: NeogovResponse; upstreamLatencyMs: number }
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
        const data = (await response.json()) as NeogovResponse
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

export const neogovAdapter: AtsAdapter = {
  name: "neogov",
  // One central host (governmentjobs.com) shared by every agency — keep the
  // per-process budget modest so co-scheduled agencies don't hammer it.
  concurrency: envConcurrency("neogov", 2),
  detectFromUrl,
  async fetchJobs({ slug, ctx }): Promise<HarvestResult> {
    const fetchedAt = new Date()
    const startedAt = Date.now()
    if (!SLUG_RE.test(slug)) throw new Error(`neogov malformed slug: ${slug}`)

    const jobs = new Map<string, HarvestedJob>()
    let latencyMs = 0
    let pagesFetched = 0
    let totalReported = 0

    for (let page = 1; page <= MAX_PAGES; page++) {
      const url = buildJobsUrl(slug, page)
      const result = await fetchPage(url, ctx)
      if (!result.ok) {
        if (page === 1) {
          const err = new Error(`neogov fetch failed: ${result.reason}`)
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
      const err = new Error("neogov fetch failed: no pages fetched")
      ;(err as Error & { status?: number | null }).status = null
      throw err
    }

    return {
      jobs: Array.from(jobs.values()),
      notModified: false,
      etag: null,
      lastModified: null,
      sourceAts: "neogov",
      sourceAtsSlug: slug,
      fetchedAt,
      upstreamLatencyMs: Math.max(latencyMs, Date.now() - startedAt),
    }
  },
}

export { buildJobsUrl, detectFromUrl }
