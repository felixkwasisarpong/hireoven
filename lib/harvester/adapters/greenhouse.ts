import { extractGreenhouseBoardToken } from "@/lib/companies/greenhouse-url"
import {
  conditionalFetchJson,
  hashContent,
  type AtsAdapter,
  type HarvestCtx,
  type HarvestResult,
  type HarvestedJob,
} from "@/lib/harvester/adapters/_base"

type GreenhouseRawJob = {
  id: number
  title?: string
  absolute_url?: string
  content?: string
  location?: { name?: string }
  updated_at?: string
  metadata?: Array<{ name?: string; value?: unknown }>
  offices?: Array<{ name?: string; location?: string }>
  departments?: Array<{ name?: string }>
}

type GreenhouseResponse = {
  jobs?: GreenhouseRawJob[]
}

/**
 * Greenhouse Job Board API (public, unauthenticated).
 * Docs: https://developers.greenhouse.io/job-board.html
 *
 * `?content=true` inlines job descriptions, saving N detail fetches per board.
 * Server honors If-None-Match/If-Modified-Since — first call returns ~few hundred KB,
 * subsequent unchanged polls return 304 with empty body.
 */
function endpointFor(slug: string): string {
  const safe = encodeURIComponent(slug)
  return `https://boards-api.greenhouse.io/v1/boards/${safe}/jobs?content=true`
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
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim()
  return text || undefined
}

function mapRawJob(raw: GreenhouseRawJob): HarvestedJob | null {
  if (!raw?.id || !raw.title || !raw.absolute_url) return null

  const description = stripHtml(raw.content)
  const location = raw.location?.name?.trim() || raw.offices?.[0]?.name?.trim() || undefined
  const postedAt = raw.updated_at ? new Date(raw.updated_at).toISOString() : undefined

  const contentHash = hashContent([
    raw.title,
    raw.absolute_url,
    location,
    postedAt,
    description?.slice(0, 4_000),
  ])

  return {
    externalId: `greenhouse:${raw.id}`,
    title: raw.title.trim(),
    applyUrl: raw.absolute_url,
    description,
    location,
    postedAt,
    contentHash,
  }
}

export const greenhouseAdapter: AtsAdapter = {
  name: "greenhouse",
  // Shared CDN-backed JSON API; tolerates high concurrency.
  concurrency: 16,

  detectFromUrl(url) {
    const slug = extractGreenhouseBoardToken(url)
    return slug ? { slug } : null
  },

  async fetchJobs({ slug, ctx }): Promise<HarvestResult> {
    const fetchedAt = new Date()
    const result = await conditionalFetchJson<GreenhouseResponse>(endpointFor(slug), ctx)

    if (result.kind === "not_modified") {
      return {
        jobs: [],
        notModified: true,
        etag: result.etag,
        lastModified: result.lastModified,
        sourceAts: "greenhouse",
        sourceAtsSlug: slug,
        fetchedAt,
        upstreamLatencyMs: result.upstreamLatencyMs,
      }
    }

    if (result.kind === "error") {
      const err = new Error(`greenhouse fetch failed: ${result.reason}`)
      ;(err as Error & { status?: number | null }).status = result.status
      throw err
    }

    const rawJobs = result.data?.jobs ?? []
    const jobs: HarvestedJob[] = []
    for (const raw of rawJobs) {
      const mapped = mapRawJob(raw)
      if (mapped) jobs.push(mapped)
    }

    return {
      jobs,
      notModified: false,
      etag: result.etag,
      lastModified: result.lastModified,
      sourceAts: "greenhouse",
      sourceAtsSlug: slug,
      fetchedAt,
      upstreamLatencyMs: result.upstreamLatencyMs,
    }
  },
}
