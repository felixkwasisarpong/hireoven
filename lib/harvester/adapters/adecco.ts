import {
  conditionalFetchJson,
  envConcurrency,
  hashContent,
  type AtsAdapter,
  type HarvestCtx,
  type HarvestResult,
  type HarvestedJob,
} from "@/lib/harvester/adapters/_base"

/**
 * Adecco (adecco.com) HTTP adapter.
 *
 * Adecco's careers site is backed by a clean, unauthenticated Solr-style JSON
 * endpoint:
 *   POST https://www.adecco.com/api/data/jobs/summarized
 *   { queryString:"&sort=PostedDate desc", filtersToDisplay:"{}", range:N,
 *     siteName:"adecco", brand:"adecco", countryCode:"US", languageCode:"en-US" }
 *   → { jobs:[ {jobId,jobTitle,cityName,stateName,minsalary,maxsalary,…} ] }
 *
 * Pagination is the `range` offset (0,10,20,… — 10/page). There is no total in
 * the response, so we page (newest-first) until a short/empty page or the cap.
 * Verified live headless with just content-type (no auth). applyUri is often
 * empty, so we fall back to the canonical /en-us/job-details/{jobId} URL (301 →
 * the SEO detail page).
 *
 * Tunables:
 *   HARVESTER_ADECCO_MAX_PAGES     (default 300 → 3000 newest jobs)
 *   HARVESTER_ADECCO_PAGE_DELAY_MS (default 120)
 *   HARVESTER_ADECCO_QUERY_STRING  (default "&sort=PostedDate desc")
 */

const ADECCO_HOST_RE = /^https?:\/\/(?:www\.)?adecco\.com\//i
const ENDPOINT = "https://www.adecco.com/api/data/jobs/summarized"
const PAGE_SIZE = 10

function intEnv(name: string, dflt: number, min = 0): number {
  const n = Number.parseInt(process.env[name] ?? "", 10)
  return Number.isFinite(n) && n >= min ? n : dflt
}
const MAX_PAGES = intEnv("HARVESTER_ADECCO_MAX_PAGES", 300, 1)
const PAGE_DELAY_MS = intEnv("HARVESTER_ADECCO_PAGE_DELAY_MS", 120, 0)
const QUERY_STRING = process.env.HARVESTER_ADECCO_QUERY_STRING?.trim() || "&sort=PostedDate desc"

type AdeccoJob = {
  jobId?: string
  jobTitle?: string
  cityName?: string
  stateName?: string
  jobLocation?: string
  description?: string
  clientJobDescription?: string
  minsalary?: number | string | null
  maxsalary?: number | string | null
  salaryCurrency?: string | null
  employmentTypeTitle?: string | null
  jobType?: string | null
  postedDate?: string | null
  firstPostedDate?: string | null
  applyUri?: string | null
}
type AdeccoResponse = { jobs?: AdeccoJob[] }

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function buildBody(range: number): string {
  return JSON.stringify({
    queryString: QUERY_STRING,
    filtersToDisplay: "{}",
    range,
    siteName: "adecco",
    brand: "adecco",
    countryCode: "US",
    languageCode: "en-US",
  })
}

function num(v: number | string | null | undefined): number | undefined {
  if (v == null) return undefined
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^0-9.]/g, ""))
  return Number.isFinite(n) && n > 0 ? n : undefined
}

function stripHtml(s: string | undefined): string | undefined {
  if (!s) return undefined
  const out = s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim()
  return out || undefined
}

function toIso(v: string | null | undefined): string | undefined {
  if (!v) return undefined
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}

export function mapJob(job: AdeccoJob): HarvestedJob | null {
  const id = (job.jobId ?? "").trim()
  const title = (job.jobTitle ?? "").trim()
  if (!id || !title) return null
  const applyUrl =
    (job.applyUri && job.applyUri.trim()) ||
    `https://www.adecco.com/en-us/job-details/${encodeURIComponent(id)}`
  const location =
    [job.cityName, job.stateName].filter((x) => x && String(x).trim()).join(", ") ||
    job.jobLocation?.trim() ||
    undefined
  const description = stripHtml(job.description || job.clientJobDescription || undefined)
  const salaryMin = num(job.minsalary)
  const salaryMax = num(job.maxsalary)
  const employmentType = (job.employmentTypeTitle || job.jobType || undefined)?.trim() || undefined
  return {
    externalId: `adecco:${id}`,
    title,
    applyUrl,
    location,
    description,
    postedAt: toIso(job.postedDate || job.firstPostedDate),
    employmentType,
    salaryMin,
    salaryMax,
    salaryCurrency: (salaryMin || salaryMax) && job.salaryCurrency ? job.salaryCurrency : undefined,
    contentHash: hashContent([title, applyUrl, location, salaryMin, salaryMax, employmentType, description?.slice(0, 4_000)]),
  }
}

export const adeccoAdapter: AtsAdapter = {
  name: "adecco",
  concurrency: envConcurrency("adecco", 1),
  detectFromUrl(url) {
    if (!ADECCO_HOST_RE.test(url)) return null
    return { slug: "adecco" }
  },
  async fetchJobs({ ctx }): Promise<HarvestResult> {
    const startedAt = Date.now()
    const jobs = new Map<string, HarvestedJob>()
    let upstreamLatencyMs = 0
    let anyOk = false

    const reqCtx: HarvestCtx = {
      ...ctx,
      etag: null,
      lastModified: null,
      timeoutMs: Math.max(ctx.timeoutMs ?? 0, 15_000),
    }

    for (let page = 0; page < MAX_PAGES; page += 1) {
      if (page > 0 && PAGE_DELAY_MS > 0) await sleep(PAGE_DELAY_MS)
      const res = await conditionalFetchJson<AdeccoResponse>(ENDPOINT, reqCtx, {
        method: "POST",
        body: buildBody(page * PAGE_SIZE),
        maxAttempts: 3,
      })
      if (res.kind !== "ok") {
        if (page === 0) {
          const err = new Error(`adecco fetch failed: ${res.kind === "error" ? res.reason : res.kind}`)
          ;(err as Error & { status?: number | null }).status = res.kind === "error" ? res.status : null
          throw err
        }
        break
      }
      anyOk = true
      upstreamLatencyMs += res.upstreamLatencyMs

      const batch = res.data.jobs ?? []
      if (batch.length === 0) break

      let added = 0
      for (const raw of batch) {
        const job = mapJob(raw)
        if (!job || jobs.has(job.externalId)) continue
        jobs.set(job.externalId, job)
        added += 1
      }
      // No new jobs (all dupes) or a short page → end of results.
      if (added === 0 || batch.length < PAGE_SIZE) break
    }

    if (!anyOk) {
      const err = new Error("adecco fetch failed: no pages fetched")
      ;(err as Error & { status?: number | null }).status = null
      throw err
    }

    return {
      jobs: Array.from(jobs.values()),
      notModified: false,
      etag: null,
      lastModified: null,
      sourceAts: "adecco",
      sourceAtsSlug: "adecco",
      fetchedAt: new Date(),
      upstreamLatencyMs: upstreamLatencyMs || Date.now() - startedAt,
    }
  },
}
