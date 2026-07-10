import {
  envConcurrency,
  hashContent,
  BROWSER_USER_AGENT,
  type AtsAdapter,
  type HarvestCtx,
  type HarvestResult,
  type HarvestedJob,
} from "@/lib/harvester/adapters/_base"
import { harvesterFetch } from "@/lib/harvester/http-agent"

/**
 * TikTok careers adapter.
 * API: https://api.lifeattiktok.com/api/v1/public/supplier/search/job/posts
 *
 * TikTok runs its own ByteDance-built careers platform at careers.tiktok.com
 * (redirects to lifeattiktok.com). The job search API is a POST endpoint that
 * returns paginated results. The "slug" for the adapter is always "tiktok" —
 * it's a single global platform with no per-tenant subdomains.
 *
 * The API does not return ETags/Last-Modified, so we skip conditional-fetch
 * optimisation and rely on content-hash change detection at the job level.
 *
 * US+CA city codes are baked in so each harvest cycle only fetches US/CA
 * openings (~1 400 currently). Pass HARVESTER_TIKTOK_ALL_REGIONS=true to
 * fetch all global regions (3 500+ jobs) instead.
 */

const BASE_URL =
  "https://api.lifeattiktok.com/api/v1/public/supplier"
const SEARCH_PATH = "/search/job/posts"
const PAGE_LIMIT = 100   // jobs per request
const MAX_PAGES  = 20    // cap total requests per harvest cycle

// US + Canada city codes returned by /config/job/filters
const US_CA_CITY_CODES = [
  "MDCY00038339", "CT_221", "MDCY00039300", "CT_233", "CT_157",
  "CT_242", "CT_94", "CT_1000001", "CT_1103554", "CT_114",
  "MDCY00008115", "CT_223", "CT_247", "CT_75", "CT_2001643",
  "CT_203", "CT_1103355",
]

type TikTokCityInfo = {
  code?: string
  en_name?: string | null
  parent?: {
    en_name?: string | null
    parent?: { en_name?: string | null } | null
  } | null
}

type TikTokRecruitType = {
  en_name?: string | null
}

type TikTokRawJob = {
  id?: string
  code?: string
  title?: string | null
  description?: string | null
  requirement?: string | null
  recruit_type?: TikTokRecruitType | null
  city_info?: TikTokCityInfo | null
}

type TikTokResponse = {
  code?: number
  data?: {
    job_post_list?: TikTokRawJob[]
    count?: number
  }
  message?: string
}

function detectFromUrl(url: string): { slug: string } | null {
  try {
    const { hostname } = new URL(url)
    const h = hostname.toLowerCase()
    if (h === "careers.tiktok.com" || h === "lifeattiktok.com") {
      return { slug: "tiktok" }
    }
  } catch {
    // fall through
  }
  return null
}

function buildLocation(city: TikTokCityInfo | null | undefined): string | undefined {
  if (!city) return undefined
  const parts: string[] = []
  if (city.en_name) parts.push(city.en_name)
  if (city.parent?.en_name) parts.push(city.parent.en_name)
  if (city.parent?.parent?.en_name) parts.push(city.parent.parent.en_name)
  return parts.length ? parts.join(", ") : undefined
}

function mapEmploymentType(rt: TikTokRecruitType | null | undefined): string | undefined {
  const name = rt?.en_name?.toLowerCase() ?? ""
  if (name === "intern") return "internship"
  if (name === "regular" || name === "experienced") return "fulltime"
  return undefined
}

function buildDescription(raw: TikTokRawJob): string | undefined {
  const parts = [raw.description, raw.requirement].filter(Boolean).join("\n\n")
  return parts || undefined
}

function mapJob(raw: TikTokRawJob): HarvestedJob | null {
  if (!raw.id || !raw.title) return null
  const externalId = `tiktok:${raw.code ?? raw.id}`
  // The public job-detail page is /search/<numeric id> (verified live: the site's
  // own listing links route there). The human-readable code (e.g. "A186244") is
  // shown ON the page but is NOT a valid route — /position/<code> 404s, which
  // silently broke every TikTok apply link. Always use the numeric id.
  const applyUrl = `https://lifeattiktok.com/search/${raw.id}`
  const location = buildLocation(raw.city_info)
  const description = buildDescription(raw)
  const employmentType = mapEmploymentType(raw.recruit_type)

  const contentHash = hashContent([
    raw.title,
    location,
    employmentType,
    description?.slice(0, 4_000),
  ])

  return {
    externalId,
    title: raw.title.trim(),
    applyUrl,
    description,
    location,
    employmentType,
    contentHash,
  }
}

async function fetchPage(
  offset: number,
  allRegions: boolean,
  ctx: HarvestCtx
): Promise<{ jobs: TikTokRawJob[]; total: number }> {
  const body = JSON.stringify({
    keyword: "",
    location_code_list: allRegions ? [] : US_CA_CITY_CODES,
    subject_id_list: [],
    tag_id_list: [],
    limit: PAGE_LIMIT,
    offset,
  })

  const res = await harvesterFetch(`${BASE_URL}${SEARCH_PATH}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      origin: "https://lifeattiktok.com",
      "website-path": "tiktok",
      "User-Agent": BROWSER_USER_AGENT,
    },
    body,
    signal: ctx.signal,
  })
  if (!res.ok) {
    const err = new Error(`tiktok API error: ${res.status}`)
    ;(err as Error & { status?: number }).status = res.status
    throw err
  }
  const data: TikTokResponse = await res.json()
  return {
    jobs: data.data?.job_post_list ?? [],
    total: data.data?.count ?? 0,
  }
}

export const tiktokAdapter: AtsAdapter = {
  name: "tiktok",
  concurrency: envConcurrency("tiktok", 1),
  detectFromUrl,

  async fetchJobs({ ctx }): Promise<HarvestResult> {  // slug unused — single global API
    const fetchedAt = new Date()
    const allRegions = process.env.HARVESTER_TIKTOK_ALL_REGIONS === "true"

    const first = await fetchPage(0, allRegions, ctx)
    const total = first.total

    const rawJobs: TikTokRawJob[] = [...first.jobs]

    // Paginate until we have all jobs or hit the page cap
    let pages = 1
    while (rawJobs.length < total && pages < MAX_PAGES) {
      const next = await fetchPage(rawJobs.length, allRegions, ctx)
      if (next.jobs.length === 0) break
      rawJobs.push(...next.jobs)
      pages++
    }

    const jobs = rawJobs.map(mapJob).filter((j): j is HarvestedJob => j !== null)

    return {
      jobs,
      notModified: false,
      etag: null,
      lastModified: null,
      sourceAts: "tiktok",
      sourceAtsSlug: "tiktok",
      fetchedAt,
      upstreamLatencyMs: 0,
    }
  },
}
