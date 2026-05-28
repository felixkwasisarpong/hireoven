import pLimit from "p-limit"
import {
  envConcurrency,
  hashContent,
  type AtsAdapter,
  type HarvestCtx,
  type HarvestResult,
  type HarvestedJob,
} from "@/lib/harvester/adapters/_base"
import { fetchHtmlConditional } from "@/lib/harvester/adapters/_json-ld"

/**
 * Rippling ATS hosted job boards.
 *   https://ats.rippling.com/{slug}/jobs
 *   https://ats.rippling.com/{slug}/jobs/{uuid}
 *
 * Rippling uses Next.js SSR — job data is embedded in __NEXT_DATA__ on the
 * listing page (paginated via `?page=N&pageSize=100`) and full job detail
 * (including HTML description) is on each job's detail page.
 *
 * Slug format: {slug} (e.g., "theguarantors-open-positions")
 */

const MAX_PAGES = Math.max(
  1,
  Number.parseInt(process.env.HARVESTER_RIPPLING_MAX_PAGES ?? "20", 10)
)
const DETAIL_MAX_JOBS = Math.max(
  0,
  Number.parseInt(process.env.HARVESTER_RIPPLING_DETAIL_MAX_JOBS ?? "100", 10)
)
const DETAIL_CONCURRENCY = Math.max(
  1,
  Number.parseInt(process.env.HARVESTER_RIPPLING_DETAIL_CONCURRENCY ?? "4", 10)
)
const PAGE_SIZE = 100

const BOARD_HOST_RE = /^ats\.rippling\.com$/i
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,79}$/i

type RipplingLocation = {
  name?: string
  country?: string
  state?: string
  city?: string
  workplaceType?: "ON_SITE" | "REMOTE" | "HYBRID" | string
}

type RipplingListingItem = {
  id?: string
  name?: string
  url?: string
  department?: { name?: string }
  locations?: RipplingLocation[]
  language?: string
}

type RipplingListingData = {
  items?: RipplingListingItem[]
  totalItems?: number
  totalPages?: number
  page?: number
  pageSize?: number
}

type RipplingDescriptionSection = { company?: string; role?: string }

type RipplingJobPost = {
  uuid?: string
  name?: string
  description?: RipplingDescriptionSection
  workLocations?: string[]
  department?: { name?: string }
  employmentType?: { label?: string | null; id?: string }
  createdOn?: string
  url?: string
  companyName?: string
  payRangeDetails?: Array<{
    minSalary?: number
    maxSalary?: number
    currency?: string
    salaryFrequency?: string
  }>
}

type RipplingNextData = {
  props?: {
    pageProps?: {
      dehydratedState?: {
        queries?: Array<{
          queryKey?: unknown[]
          state?: { data?: unknown }
        }>
      }
      apiData?: {
        jobPost?: RipplingJobPost
      }
    }
  }
}

function cleanSlug(value: string | undefined | null): string | null {
  if (!value) return null
  const v = value.trim().toLowerCase()
  if (!SLUG_RE.test(v)) return null
  return v
}

function detectFromUrl(url: string): { slug: string } | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (!BOARD_HOST_RE.test(parsed.hostname)) return null
  const parts = parsed.pathname.split("/").filter(Boolean)
  if (parts.length < 1) return null
  // Accept both /slug/jobs and /slug/jobs/{uuid}
  if (parts[1] && parts[1] !== "jobs") return null
  const slug = cleanSlug(parts[0])
  if (!slug) return null
  return { slug }
}

function listingUrl(slug: string, page: number): string {
  return `https://ats.rippling.com/${encodeURIComponent(slug)}/jobs?page=${page}&pageSize=${PAGE_SIZE}`
}

function detailUrl(slug: string, uuid: string): string {
  return `https://ats.rippling.com/${encodeURIComponent(slug)}/jobs/${encodeURIComponent(uuid)}`
}

function parseNextData(html: string): RipplingNextData | null {
  const m = html.match(/<script\s+id="__NEXT_DATA__"[^>]*>([\s\S]+?)<\/script>/)
  if (!m) return null
  try {
    return JSON.parse(m[1]) as RipplingNextData
  } catch {
    return null
  }
}

function extractListingData(data: RipplingNextData): RipplingListingData | null {
  const queries = data.props?.pageProps?.dehydratedState?.queries
  if (!Array.isArray(queries)) return null
  for (const q of queries) {
    if (!Array.isArray(q.queryKey)) continue
    if (q.queryKey[2] !== "job-posts") continue
    const d = q.state?.data
    if (!d || typeof d !== "object") continue
    return d as RipplingListingData
  }
  return null
}

function stripHtml(html: string | undefined | null): string | undefined {
  if (!html) return undefined
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<meta[^>]*>/gi, "")
    .replace(/<\/(p|div|li|br|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s{2,}/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  return text || undefined
}

function buildDescription(desc: RipplingDescriptionSection | undefined | null): string | undefined {
  if (!desc) return undefined
  const parts = [stripHtml(desc.company), stripHtml(desc.role)]
    .filter((p): p is string => Boolean(p))
  return parts.length > 0 ? parts.join("\n\n") : undefined
}

function flattenLocation(locs: RipplingLocation[] | undefined): string | undefined {
  if (!locs || locs.length === 0) return undefined
  const names = locs
    .map((l) => l.name?.trim())
    .filter((n): n is string => Boolean(n))
  return names.length > 0 ? names.join(", ") : undefined
}

function mapWorkMode(locs: RipplingLocation[] | undefined): string | undefined {
  if (!locs) return undefined
  const types = locs.map((l) => (l.workplaceType ?? "").toUpperCase())
  if (types.some((t) => t === "REMOTE")) return "remote"
  if (types.some((t) => t === "HYBRID")) return "hybrid"
  return undefined
}

function mapEmploymentType(et: RipplingJobPost["employmentType"]): string | undefined {
  if (!et) return undefined
  const raw = et.label?.trim() || et.id?.trim()
  if (!raw) return undefined
  const v = raw.toLowerCase()
  if (v.includes("intern")) return "internship"
  if (v.includes("full") || v === "full_time" || v === "full-time") return "full-time"
  if (v.includes("part") || v === "part_time" || v === "part-time") return "part-time"
  if (v.includes("contract")) return "contract"
  return raw
}

type RipplingMapped = HarvestedJob & { uuid: string }

function mapListingItem(item: RipplingListingItem, slug: string): RipplingMapped | null {
  const uuid = item.id?.trim()
  const title = item.name?.trim()
  if (!uuid || !title) return null
  const applyUrl = item.url?.trim() || detailUrl(slug, uuid)
  const location = flattenLocation(item.locations)
  const workMode = mapWorkMode(item.locations)
  return {
    externalId: `rippling:${slug}:${uuid}`,
    title,
    applyUrl,
    location,
    workMode,
    contentHash: hashContent([title, applyUrl, location, workMode]),
    uuid,
  }
}

async function fetchListingPage(
  slug: string,
  page: number,
  ctx: HarvestCtx
): Promise<{ data: RipplingListingData; latencyMs: number; etag: string | null; lastModified: string | null } | null> {
  const url = listingUrl(slug, page)
  const result = await fetchHtmlConditional(url, {
    ...ctx,
    etag: null,
    lastModified: null,
  })
  if (result.kind !== "ok") return null
  const nextData = parseNextData(result.html)
  if (!nextData) return null
  const listData = extractListingData(nextData)
  if (!listData) return null
  return {
    data: listData,
    latencyMs: result.upstreamLatencyMs,
    etag: result.etag,
    lastModified: result.lastModified,
  }
}

async function fetchJobDetail(
  job: RipplingMapped,
  slug: string,
  ctx: HarvestCtx
): Promise<HarvestedJob | null> {
  const url = detailUrl(slug, job.uuid)
  const result = await fetchHtmlConditional(url, {
    ...ctx,
    etag: null,
    lastModified: null,
  })
  if (result.kind !== "ok") return null
  const nextData = parseNextData(result.html)
  const jobPost = nextData?.props?.pageProps?.apiData?.jobPost
  if (!jobPost) return null

  const description = buildDescription(jobPost.description)
  const location = (jobPost.workLocations ?? []).filter(Boolean).join(", ") || job.location
  const workMode = job.workMode
  const employmentType = mapEmploymentType(jobPost.employmentType)
  const postedAt = jobPost.createdOn ? new Date(jobPost.createdOn).toISOString() : undefined
  const payDetails = Array.isArray(jobPost.payRangeDetails) ? jobPost.payRangeDetails[0] : undefined
  const salaryMin = payDetails?.minSalary ?? undefined
  const salaryMax = payDetails?.maxSalary ?? undefined
  const salaryCurrency = payDetails?.currency ?? undefined

  return {
    externalId: job.externalId,
    title: jobPost.name?.trim() || job.title,
    applyUrl: job.applyUrl,
    description,
    location: location || undefined,
    workMode,
    employmentType,
    postedAt,
    salaryMin: typeof salaryMin === "number" ? salaryMin : undefined,
    salaryMax: typeof salaryMax === "number" ? salaryMax : undefined,
    salaryCurrency,
    contentHash: hashContent([
      jobPost.name?.trim() || job.title,
      job.applyUrl,
      location || undefined,
      workMode,
      employmentType,
      postedAt,
      description?.slice(0, 4_000),
    ]),
  }
}

function shallowJob(job: RipplingMapped): HarvestedJob {
  return {
    externalId: job.externalId,
    title: job.title,
    applyUrl: job.applyUrl,
    location: job.location,
    workMode: job.workMode,
    contentHash: job.contentHash,
  }
}

async function enrichWithDetails(
  jobs: RipplingMapped[],
  slug: string,
  ctx: HarvestCtx
): Promise<HarvestedJob[]> {
  if (DETAIL_MAX_JOBS === 0) return jobs.map(shallowJob)
  const alreadyDescribed = ctx.alreadyDescribedIds
  const needDetail = alreadyDescribed
    ? jobs.filter((j) => !alreadyDescribed.has(j.externalId))
    : jobs
  const limiter = pLimit(DETAIL_CONCURRENCY)
  const enriched = new Map<string, HarvestedJob>()
  await Promise.all(
    needDetail.slice(0, DETAIL_MAX_JOBS).map((job) =>
      limiter(async () => {
        const detail = await fetchJobDetail(job, slug, ctx)
        if (detail) enriched.set(job.uuid, detail)
      })
    )
  )
  return jobs.map((j) => enriched.get(j.uuid) ?? shallowJob(j))
}

export const ripplingAdapter: AtsAdapter = {
  name: "rippling",
  concurrency: envConcurrency("rippling", 4),
  detectFromUrl,
  async fetchJobs({ slug, ctx }): Promise<HarvestResult> {
    const fetchedAt = new Date()
    const startedAt = Date.now()
    const cleanedSlug = cleanSlug(slug)
    if (!cleanedSlug) throw new Error(`rippling malformed slug: ${slug}`)

    const jobs = new Map<string, RipplingMapped>()
    let latencyMs = 0
    let etag: string | null = null
    let lastModified: string | null = null
    let successfulPages = 0

    for (let page = 0; page < MAX_PAGES; page++) {
      const result = await fetchListingPage(cleanedSlug, page, ctx)
      if (!result) {
        if (page === 0) {
          const err = new Error(`rippling fetch failed: listing page 0 unreachable for ${cleanedSlug}`)
          ;(err as Error & { status?: number | null }).status = null
          throw err
        }
        break
      }
      successfulPages += 1
      latencyMs += result.latencyMs
      etag ??= result.etag
      lastModified ??= result.lastModified

      const items = result.data.items ?? []
      let added = 0
      for (const item of items) {
        const mapped = mapListingItem(item, cleanedSlug)
        if (!mapped || jobs.has(mapped.uuid)) continue
        jobs.set(mapped.uuid, mapped)
        added += 1
      }

      const total = result.data.totalItems ?? 0
      const pagesFetched = page + 1
      const covered = pagesFetched * PAGE_SIZE
      if (added === 0 || covered >= total) break
    }

    if (successfulPages === 0) {
      const err = new Error("rippling fetch failed: no reachable listing pages")
      ;(err as Error & { status?: number | null }).status = null
      throw err
    }

    const allJobs = Array.from(jobs.values())
    const out = allJobs.length ? await enrichWithDetails(allJobs, cleanedSlug, ctx) : []

    return {
      jobs: out,
      notModified: false,
      etag,
      lastModified,
      sourceAts: "rippling",
      sourceAtsSlug: cleanedSlug,
      fetchedAt,
      upstreamLatencyMs: Math.max(latencyMs, Date.now() - startedAt),
    }
  },
}

export { detectFromUrl, fetchJobDetail }
