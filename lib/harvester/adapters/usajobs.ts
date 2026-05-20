import {
  hashContent,
  type AtsAdapter,
  type HarvestCtx,
  type HarvestResult,
  type HarvestedJob,
} from "@/lib/harvester/adapters/_base"

/**
 * USAJOBS aggregator adapter.
 *
 * Treats every federal hiring department as a separate "company". Each
 * tenant slug is a USAJOBS `Organization` parameter — typically the
 * department name (`Veterans Health Administration`) or a shorter code we
 * have observed working in production. The seed script enumerates the
 * curated list of major federal departments and creates one company per
 * slug with a synthetic careers URL of the form
 *   https://www.usajobs.gov/Search/Results?d={slug}
 *
 * API surface used:
 *   GET https://data.usajobs.gov/api/search
 *     ?Organization={slug}
 *     &Page={N}                   1-indexed
 *     &ResultsPerPage=500         hard cap; results truncated above
 *     &SortField=OpenDate
 *     &SortDirection=Desc
 *
 * Auth: USAJOBS requires two headers on every request:
 *   Authorization-Key:  $USAJOBS_API_KEY     (free, register at developer.usajobs.gov)
 *   User-Agent:         $USAJOBS_USER_AGENT  (your contact email)
 *
 * The API does NOT support conditional requests (no ETag / Last-Modified),
 * so we always do a full pull and rely on externalId-based dedup in the
 * persister.
 */

const API_BASE = "https://data.usajobs.gov/api/search"
const RESULTS_PER_PAGE = Math.max(
  10,
  Math.min(500, Number.parseInt(process.env.HARVESTER_USAJOBS_PAGE_SIZE ?? "500", 10))
)
const MAX_PAGES = Math.max(
  1,
  Number.parseInt(process.env.HARVESTER_USAJOBS_MAX_PAGES ?? "20", 10)
)
const DEFAULT_TIMEOUT_MS = 15_000
const RETRY_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504])

const SYNTHETIC_HOST = "www.usajobs.gov"
// Slug allows letters / digits / dash / underscore / dot. We URL-encode the
// raw slug into the synthetic careers_url, so even a slug with spaces stays
// inside the regex via percent-encoding when round-tripping through URL().
const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,127}$/

type USAJobsLocation = {
  LocationName?: string
  CountryCode?: string
  CountrySubDivisionCode?: string
  CityName?: string
}

type USAJobsRemuneration = {
  MinimumRange?: string
  MaximumRange?: string
  RateIntervalCode?: string
}

type USAJobsPositionDescriptor = {
  PositionID?: string
  PositionTitle?: string
  PositionURI?: string
  ApplyURI?: string[]
  PositionLocationDisplay?: string
  PositionLocation?: USAJobsLocation[]
  OrganizationName?: string
  DepartmentName?: string
  PositionStartDate?: string
  PositionEndDate?: string
  PublicationStartDate?: string
  ApplicationCloseDate?: string
  QualificationSummary?: string
  PositionRemuneration?: USAJobsRemuneration[]
  PositionSchedule?: Array<{ Name?: string }>
  PositionOfferingType?: Array<{ Name?: string }>
  UserArea?: {
    Details?: {
      JobSummary?: string
      WorkSchedule?: string
      // API returns either a string ("Yes" / "True") or a boolean depending
      // on agency and posting age. Treat both as the same signal.
      TeleworkEligible?: string | boolean
      RemoteIndicator?: string | boolean
    }
  }
}

type USAJobsSearchItem = {
  MatchedObjectId?: string
  MatchedObjectDescriptor?: USAJobsPositionDescriptor
}

type USAJobsSearchResponse = {
  LanguageCode?: string
  SearchResult?: {
    SearchResultCount?: number
    SearchResultCountAll?: number
    SearchResultItems?: USAJobsSearchItem[]
  }
}

function detectFromUrl(url: string): { slug: string } | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.hostname.toLowerCase() !== SYNTHETIC_HOST) return null
  // Accept two synthetic shapes:
  //   /Search/Results?d=<slug>      — preferred
  //   /agency/<slug>                — short form used by the seed script
  const d = parsed.searchParams.get("d")
  if (parsed.pathname.toLowerCase() === "/search/results" && d) {
    return SLUG_RE.test(d) ? { slug: d } : null
  }
  const parts = parsed.pathname.split("/").filter(Boolean)
  if (parts[0]?.toLowerCase() === "agency" && parts[1]) {
    const slug = decodeURIComponent(parts[1])
    return SLUG_RE.test(slug) ? { slug } : null
  }
  return null
}

function buildSearchUrl(slug: string, page: number): string {
  const params = new URLSearchParams({
    Organization: slug,
    Page: String(page),
    ResultsPerPage: String(RESULTS_PER_PAGE),
    SortField: "OpenDate",
    SortDirection: "Desc",
  })
  return `${API_BASE}?${params.toString()}`
}

function applyUrlFromDescriptor(d: USAJobsPositionDescriptor): string | undefined {
  const apply = d.ApplyURI?.find((u) => typeof u === "string" && u.trim().length > 0)
  if (apply) return apply
  if (d.PositionURI?.trim()) return d.PositionURI.trim()
  return undefined
}

function locationFromDescriptor(d: USAJobsPositionDescriptor): string | undefined {
  if (d.PositionLocationDisplay?.trim()) return d.PositionLocationDisplay.trim()
  const loc = d.PositionLocation?.[0]
  if (!loc) return undefined
  if (loc.LocationName?.trim()) return loc.LocationName.trim()
  const parts = [loc.CityName, loc.CountrySubDivisionCode, loc.CountryCode]
    .map((p) => p?.trim())
    .filter((p): p is string => Boolean(p))
  return parts.length ? parts.join(", ") : undefined
}

function coerceYesNo(value: string | boolean | undefined): boolean {
  if (typeof value === "boolean") return value
  if (typeof value !== "string") return false
  const v = value.trim().toLowerCase()
  return v === "true" || v === "yes" || v === "y"
}

function workModeFromDescriptor(d: USAJobsPositionDescriptor): string | undefined {
  const details = d.UserArea?.Details
  if (!details) return undefined
  if (coerceYesNo(details.RemoteIndicator)) return "remote"
  if (coerceYesNo(details.TeleworkEligible)) return "hybrid"
  return undefined
}

function employmentTypeFromDescriptor(d: USAJobsPositionDescriptor): string | undefined {
  const sched = d.PositionSchedule?.[0]?.Name?.trim()
  if (sched) return sched
  const offer = d.PositionOfferingType?.[0]?.Name?.trim()
  return offer || undefined
}

function annualSalaryFromDescriptor(
  d: USAJobsPositionDescriptor
): { min?: number; max?: number; currency?: string } | null {
  const rem = d.PositionRemuneration?.[0]
  if (!rem) return null
  const interval = rem.RateIntervalCode?.trim().toUpperCase() ?? ""
  // PA = Per Annum, AN = Annual. Skip hourly/daily — out of normalization scope.
  if (interval && interval !== "PA" && interval !== "AN" && interval !== "PER YEAR") return null
  const min = rem.MinimumRange ? Math.round(Number.parseFloat(rem.MinimumRange)) : undefined
  const max = rem.MaximumRange ? Math.round(Number.parseFloat(rem.MaximumRange)) : undefined
  if (!Number.isFinite(min ?? 0) && !Number.isFinite(max ?? 0)) return null
  if (min === undefined && max === undefined) return null
  if ((min ?? 0) > 0 && (min ?? 0) < 10_000) return null
  if ((max ?? 0) > 2_000_000) return null
  return { min, max, currency: "USD" }
}

function descriptionFromDescriptor(d: USAJobsPositionDescriptor): string | undefined {
  const parts = [d.UserArea?.Details?.JobSummary, d.QualificationSummary]
    .map((p) => p?.trim())
    .filter((p): p is string => Boolean(p))
  return parts.length ? parts.join("\n\n") : undefined
}

export function mapItemToJob(slug: string, item: USAJobsSearchItem): HarvestedJob | null {
  const d = item.MatchedObjectDescriptor
  if (!d) return null
  const title = d.PositionTitle?.trim()
  if (!title) return null
  const externalIdRaw = item.MatchedObjectId?.trim() || d.PositionID?.trim()
  if (!externalIdRaw) return null
  const applyUrl = applyUrlFromDescriptor(d)
  if (!applyUrl) return null

  const description = descriptionFromDescriptor(d)
  const location = locationFromDescriptor(d)
  const postedAt = d.PublicationStartDate
    ? new Date(d.PublicationStartDate).toISOString()
    : undefined
  const workMode = workModeFromDescriptor(d)
  const employmentType = employmentTypeFromDescriptor(d)
  const salary = annualSalaryFromDescriptor(d)

  return {
    externalId: `usajobs:${slug}:${externalIdRaw}`,
    title,
    applyUrl,
    description,
    location,
    postedAt,
    workMode,
    employmentType,
    salaryMin: salary?.min,
    salaryMax: salary?.max,
    salaryCurrency: salary?.currency,
    contentHash: hashContent([
      title,
      applyUrl,
      location,
      postedAt,
      workMode,
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
  ctx: HarvestCtx,
  apiKey: string,
  userAgent: string
): Promise<
  | { ok: true; data: USAJobsSearchResponse; upstreamLatencyMs: number }
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
          "user-agent": userAgent,
          "authorization-key": apiKey,
          host: "data.usajobs.gov",
        },
        signal: controller.signal,
      })
      upstreamLatencyMs += Date.now() - startedAt
      if (response.ok) {
        const data = (await response.json()) as USAJobsSearchResponse
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

export const usajobsAdapter: AtsAdapter = {
  name: "usajobs",
  // One central API host (data.usajobs.gov) shared by every "tenant" — keep
  // the per-process budget modest so two agencies on the same shard don't
  // hammer the rate limiter.
  concurrency: 2,
  detectFromUrl,
  async fetchJobs({ slug, ctx }): Promise<HarvestResult> {
    const fetchedAt = new Date()
    const startedAt = Date.now()
    if (!SLUG_RE.test(slug)) throw new Error(`usajobs malformed slug: ${slug}`)

    const apiKey = process.env.USAJOBS_API_KEY?.trim()
    const userAgent =
      process.env.USAJOBS_USER_AGENT?.trim() ||
      process.env.HARVESTER_CONTACT_EMAIL?.trim()
    if (!apiKey || !userAgent) {
      const err = new Error(
        "usajobs adapter requires USAJOBS_API_KEY and USAJOBS_USER_AGENT env vars (register at developer.usajobs.gov)"
      )
      ;(err as Error & { status?: number | null }).status = 401
      throw err
    }

    const jobs = new Map<string, HarvestedJob>()
    let latencyMs = 0
    let pagesFetched = 0
    let totalReported = 0

    for (let page = 1; page <= MAX_PAGES; page++) {
      const url = buildSearchUrl(slug, page)
      const result = await fetchPage(url, ctx, apiKey, userAgent)
      if (!result.ok) {
        if (page === 1) {
          const err = new Error(`usajobs fetch failed: ${result.reason}`)
          ;(err as Error & { status?: number | null }).status = result.status
          throw err
        }
        break
      }
      pagesFetched += 1
      latencyMs += result.upstreamLatencyMs
      const sr = result.data.SearchResult
      const items = sr?.SearchResultItems ?? []
      totalReported = sr?.SearchResultCountAll ?? totalReported
      let added = 0
      for (const item of items) {
        const job = mapItemToJob(slug, item)
        if (!job) continue
        if (jobs.has(job.externalId)) continue
        jobs.set(job.externalId, job)
        added += 1
      }
      // Stop when this page returned fewer results than the page size, OR
      // we've collected the full set. USAJOBS caps at SearchResultCountAll.
      if (items.length < RESULTS_PER_PAGE) break
      if (added === 0) break
      if (totalReported && jobs.size >= totalReported) break
    }

    if (pagesFetched === 0) {
      const err = new Error("usajobs fetch failed: no pages fetched")
      ;(err as Error & { status?: number | null }).status = null
      throw err
    }

    return {
      jobs: Array.from(jobs.values()),
      notModified: false,
      etag: null,
      lastModified: null,
      sourceAts: "usajobs",
      sourceAtsSlug: slug,
      fetchedAt,
      upstreamLatencyMs: Math.max(latencyMs, Date.now() - startedAt),
    }
  },
}

export { buildSearchUrl, detectFromUrl }
