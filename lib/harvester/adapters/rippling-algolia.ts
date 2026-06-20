/**
 * Rippling (the company) Algolia-based jobs adapter.
 *
 * Rippling's public open-roles page (rippling.com/careers/open-roles) is backed
 * by an Algolia index. The credentials are embedded in the page's JS bundle and
 * are public search-only keys. The job-detail pages are served from the same
 * Rippling ATS host used by their customers: ats.rippling.com/rippling/jobs/{uuid}.
 *
 * Listing: Algolia REST API (no SDK dependency)
 *   Index:  careers_en-US_production
 *   AppId:  6FNAX3TBEF
 *   ApiKey: 416caa4690f002ff6fe4a2097623640b  (search-only, public)
 *
 * Detail: ats.rippling.com/rippling/jobs/{uuid} via fetchJobDetail from the
 *   rippling adapter (same __NEXT_DATA__ parsing).
 *
 * ats_identifier: "rippling" (the slug passed to the detail URL builder)
 */

import pLimit from "p-limit"
import {
  conditionalFetchJson,
  envConcurrency,
  hashContent,
  type AtsAdapter,
  type HarvestCtx,
  type HarvestResult,
  type HarvestedJob,
} from "@/lib/harvester/adapters/_base"
import { harvesterFetch } from "@/lib/harvester/http-agent"
import { fetchJobDetail } from "@/lib/harvester/adapters/rippling"

const ALGOLIA_APP_ID = "6FNAX3TBEF"
const ALGOLIA_API_KEY = "416caa4690f002ff6fe4a2097623640b"
const ALGOLIA_INDEX = "careers_en-US_production"
const ALGOLIA_BASE = `https://${ALGOLIA_APP_ID}-dsn.algolia.net/1/indexes/${ALGOLIA_INDEX}/query`

const COMPANY_SLUG = "rippling"
const PAGE_SIZE = 200

function intEnv(name: string, dflt: number): number {
  const n = Number.parseInt(process.env[name] ?? "", 10)
  return Number.isFinite(n) && n > 0 ? n : dflt
}

const DETAIL_MAX_JOBS = intEnv("HARVESTER_RIPPLING_ALGOLIA_DETAIL_MAX_JOBS", 150)
const DETAIL_CONCURRENCY = intEnv("HARVESTER_RIPPLING_ALGOLIA_DETAIL_CONCURRENCY", 4)

type AlgoliaLocation = {
  country?: string
  countryCode?: string
  name?: string
  workplaceType?: "REMOTE" | "ON_SITE" | "HYBRID" | string
}

type AlgoliaHit = {
  objectID?: string
  jobId?: string
  name?: string
  department?: { name?: string }
  departmentName?: string
  isRemote?: boolean
  locationNames?: string[]
  locations?: AlgoliaLocation[]
  url?: string
}

type AlgoliaResponse = {
  hits?: AlgoliaHit[]
  nbHits?: number
  nbPages?: number
  page?: number
}

type AlgoliaMapped = HarvestedJob & { uuid: string }

function flattenLocations(hit: AlgoliaHit): string | undefined {
  const names = hit.locationNames?.filter(Boolean)
  if (names && names.length > 0) return names.join(", ")
  return undefined
}

function detectWorkMode(hit: AlgoliaHit): string | undefined {
  if (hit.isRemote) return "remote"
  const types = (hit.locations ?? []).map((l) => l.workplaceType?.toUpperCase() ?? "")
  if (types.some((t) => t === "REMOTE")) return "remote"
  if (types.some((t) => t === "HYBRID")) return "hybrid"
  return undefined
}

function mapHit(hit: AlgoliaHit): AlgoliaMapped | null {
  const uuid = hit.jobId ?? hit.objectID?.split("__")[0]
  const title = hit.name?.trim()
  if (!uuid || !title) return null

  const applyUrl = hit.url?.trim() ?? `https://ats.rippling.com/${COMPANY_SLUG}/jobs/${uuid}`
  const location = flattenLocations(hit)
  const workMode = detectWorkMode(hit)

  return {
    externalId: `rippling:${COMPANY_SLUG}:${uuid}`,
    title,
    applyUrl,
    location,
    workMode,
    uuid,
    contentHash: hashContent([title, applyUrl, location, workMode]),
  }
}

async function fetchAlgoliaPage(
  page: number,
  ctx: HarvestCtx
): Promise<{ hits: AlgoliaHit[]; nbHits: number; nbPages: number; latencyMs: number } | null> {
  const body = JSON.stringify({ query: "", hitsPerPage: PAGE_SIZE, page })
  const result = await conditionalFetchJson<AlgoliaResponse>(ALGOLIA_BASE, ctx, {
    method: "POST",
    body,
    maxAttempts: 3,
  })
  if (result.kind !== "ok") return null
  return {
    hits: result.data.hits ?? [],
    nbHits: result.data.nbHits ?? 0,
    nbPages: result.data.nbPages ?? 1,
    latencyMs: result.upstreamLatencyMs,
  }
}

export const ripplingAlgoliaAdapter: AtsAdapter = {
  name: "rippling-algolia",
  concurrency: envConcurrency("rippling-algolia", 2),

  detectFromUrl(url: string): { slug: string } | null {
    if (/rippling\.com\/careers/i.test(url)) return { slug: COMPANY_SLUG }
    return null
  },

  async fetchJobs({ ctx }): Promise<HarvestResult> {
    const fetchedAt = new Date()
    const startedAt = Date.now()

    // Algolia requires auth headers (X-Algolia-*). Inject them via a custom fetchImpl.
    const baseFetch = ctx.fetchImpl ?? harvesterFetch
    const algoliaFetch: typeof fetch = (input, init) => {
      const headers = new Headers(init?.headers)
      headers.set("X-Algolia-Application-Id", ALGOLIA_APP_ID)
      headers.set("X-Algolia-API-Key", ALGOLIA_API_KEY)
      return baseFetch(input, { ...init, headers })
    }
    const algoliaCtxWithFetch: HarvestCtx = { ...ctx, etag: null, lastModified: null, fetchImpl: algoliaFetch }

    const seen = new Map<string, AlgoliaMapped>()
    let totalLatencyMs = 0

    const firstPage = await fetchAlgoliaPage(0, algoliaCtxWithFetch)
    if (!firstPage) {
      const err = new Error("rippling-algolia: Algolia page 0 fetch failed")
      ;(err as Error & { status?: number | null }).status = null
      throw err
    }
    totalLatencyMs += firstPage.latencyMs
    for (const hit of firstPage.hits) {
      const mapped = mapHit(hit)
      if (mapped && !seen.has(mapped.uuid)) seen.set(mapped.uuid, mapped)
    }

    // Fetch remaining pages in parallel (Algolia is fast)
    const remainingPages = firstPage.nbPages - 1
    if (remainingPages > 0) {
      const pageNums = Array.from({ length: remainingPages }, (_, i) => i + 1)
      const limiter = pLimit(4)
      await Promise.all(
        pageNums.map((p) =>
          limiter(async () => {
            const result = await fetchAlgoliaPage(p, algoliaCtxWithFetch)
            if (!result) return
            totalLatencyMs += result.latencyMs
            for (const hit of result.hits) {
              const mapped = mapHit(hit)
              if (mapped && !seen.has(mapped.uuid)) seen.set(mapped.uuid, mapped)
            }
          })
        )
      )
    }

    const allJobs = Array.from(seen.values())

    // Enrich with full descriptions from ats.rippling.com detail pages
    const needDetail = ctx.alreadyDescribedIds
      ? allJobs.filter((j) => !ctx.alreadyDescribedIds!.has(j.externalId))
      : allJobs

    const enriched = new Map<string, HarvestedJob>()
    if (DETAIL_MAX_JOBS > 0 && needDetail.length > 0) {
      const limiter = pLimit(DETAIL_CONCURRENCY)
      await Promise.all(
        needDetail.slice(0, DETAIL_MAX_JOBS).map((job) =>
          limiter(async () => {
            const detail = await fetchJobDetail(job, COMPANY_SLUG, ctx)
            if (detail) enriched.set(job.uuid, detail)
          })
        )
      )
    }

    const out: HarvestedJob[] = allJobs.map((j) => {
      const d = enriched.get(j.uuid)
      if (d) return d
      return {
        externalId: j.externalId,
        title: j.title,
        applyUrl: j.applyUrl,
        location: j.location,
        workMode: j.workMode,
        contentHash: j.contentHash,
      }
    })

    return {
      jobs: out,
      notModified: false,
      etag: null,
      lastModified: null,
      sourceAts: "rippling-algolia",
      sourceAtsSlug: COMPANY_SLUG,
      fetchedAt,
      upstreamLatencyMs: Math.max(totalLatencyMs, Date.now() - startedAt),
    }
  },
}
