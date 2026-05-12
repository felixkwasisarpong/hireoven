import pLimit from "p-limit"
import {
  hashContent,
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
const MAX_PAGES = 50 // 1000 postings/board ceiling
const DEFAULT_LOCALE = "en-US"
const DEFAULT_USER_AGENT = "hireoven-harvester/1.0 (+bot@hireoven.com)"
const DEFAULT_TIMEOUT_MS = 15_000
const RETRY_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504])

// Per-job detail fetch — enriches descriptions beyond the bullet snippets.
// Env-tunable for operators who want to trade throughput for richer text.
const DETAIL_MAX_JOBS = Math.max(
  0,
  Number.parseInt(process.env.HARVESTER_WORKDAY_DETAIL_MAX_JOBS ?? "100", 10)
)
const DETAIL_CONCURRENCY = Math.max(
  1,
  Number.parseInt(process.env.HARVESTER_WORKDAY_DETAIL_CONCURRENCY ?? "4", 10)
)
const DETAIL_TIMEOUT_MS = Math.max(
  1_000,
  Number.parseInt(process.env.HARVESTER_WORKDAY_DETAIL_TIMEOUT_MS ?? "8000", 10)
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

type WorkdayListingResponse = {
  total?: number
  jobPostings?: WorkdayPosting[]
}

type ParsedSlug = {
  tenant: string
  wd: string
  site: string
}

const WD_HOST_RE = /^([a-z0-9-]+)\.(wd\d{1,3})\.myworkdayjobs\.com$/i

function isLocaleSegment(segment: string): boolean {
  return /^[a-z]{2}(-[a-z]{2,3})?$/i.test(segment)
}

function parseSlug(slug: string): ParsedSlug | null {
  const parts = slug.split(":")
  if (parts.length !== 3) return null
  const [tenant, wd, site] = parts
  if (!tenant || !wd || !site) return null
  if (!/^[a-z0-9-]+$/i.test(tenant)) return null
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

  const m = parsed.hostname.toLowerCase().match(WD_HOST_RE)
  if (!m) return null
  const tenant = m[1]
  const wd = m[2]

  const parts = parsed.pathname
    .split("/")
    .filter(Boolean)
    .map((p) => decodeURIComponent(p).trim())
    .filter(Boolean)

  // Strip leading locale segment (e.g. `en-US`) — the site name follows.
  const startIdx = parts.length > 0 && isLocaleSegment(parts[0]) ? 1 : 0
  const site = parts[startIdx]
  if (!site) return null
  if (!/^[A-Za-z0-9_-]+$/.test(site)) return null

  return { slug: `${tenant}:${wd}:${site}` }
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

function stripHtml(value: string | undefined | null): string | undefined {
  if (!value) return undefined
  const text = value
    .replace(/<\/(p|div|li|br|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
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

  try {
    const response = await doFetch(url, {
      method: "GET",
      headers: { "user-agent": userAgent, accept: "application/json" },
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

    try {
      const response = await doFetch(url, {
        method: "POST",
        headers: {
          "user-agent": userAgent,
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
      if (attempt >= maxAttempts) {
        return { kind: "error", status: null, reason: lastReason, upstreamLatencyMs }
      }
      await sleep(250 * 2 ** (attempt - 1) + Math.random() * 250)
    } finally {
      clearTimeout(timer)
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
  ctx: HarvestCtx
): Promise<void> {
  if (DETAIL_MAX_JOBS === 0) return
  const targets = jobs.filter((j) => Boolean(j.externalPath)).slice(0, DETAIL_MAX_JOBS)
  if (targets.length === 0) return

  const limit = pLimit(DETAIL_CONCURRENCY)
  await Promise.all(
    targets.map((job) =>
      limit(async () => {
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

export const workdayAdapter: AtsAdapter = {
  name: "workday",
  // Each tenant is its own host + slow paginated POSTs (30-60s per board).
  // 4 concurrent across all tenants keeps the slot pool from being dominated.
  concurrency: 4,
  detectFromUrl,
  async fetchJobs({ slug, ctx }): Promise<HarvestResult> {
    const fetchedAt = new Date()
    const parsed = parseSlug(slug)
    if (!parsed) {
      throw new Error(`workday: invalid slug "${slug}"`)
    }

    const url = listingUrl(parsed)
    const jobs: Array<HarvestedJob & { externalPath: string | undefined }> = []
    let upstreamLatencyMs = 0
    let offset = 0
    let pageCount = 0

    while (pageCount < MAX_PAGES) {
      pageCount += 1
      const result = await postWorkdayListing(
        url,
        { appliedFacets: {}, limit: PAGE_LIMIT, offset, searchText: "" },
        ctx
      )
      upstreamLatencyMs += result.upstreamLatencyMs

      if (result.kind === "error") {
        if (pageCount === 1) {
          const err = new Error(`workday fetch failed: ${result.reason}`)
          ;(err as Error & { status?: number | null }).status = result.status
          throw err
        }
        break
      }

      const postings = result.data.jobPostings ?? []
      if (postings.length === 0) break
      for (const raw of postings) {
        const mapped = mapRawJob(parsed, raw)
        if (mapped) jobs.push(mapped)
      }
      if (postings.length < PAGE_LIMIT) break
      offset += PAGE_LIMIT
    }

    // Phase 2: fetch per-job detail to populate full descriptions. The
    // listing-only `bulletFields` is too sparse for matching/skills
    // extraction. Capped at DETAIL_MAX_JOBS per board, DETAIL_CONCURRENCY
    // parallel — env-tunable for operators tuning throughput vs richness.
    const detailStart = Date.now()
    await enrichWithDetail(parsed, jobs, ctx)
    upstreamLatencyMs += Date.now() - detailStart

    return {
      jobs,
      notModified: false,
      // Workday CXS doesn't honor If-None-Match on POST; conditional headers
      // are not applicable. Leaving etag/lastModified as null so the worker
      // doesn't waste a header on the next call.
      etag: null,
      lastModified: null,
      sourceAts: "workday",
      sourceAtsSlug: slug,
      fetchedAt,
      upstreamLatencyMs,
    }
  },
}
