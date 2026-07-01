import {
  envConcurrency,
  conditionalFetchJson,
  hashContent,
  type AtsAdapter,
  type HarvestCtx,
  type HarvestResult,
  type HarvestedJob,
} from "@/lib/harvester/adapters/_base"

/**
 * Recruiterbox (rebranded Trakstar Hire) public openings API.
 *   GET https://jsapi.recruiterbox.com/v1/openings?client_name={slug}&offset={n}&limit=100
 *
 * Returns `{"meta": {offset, limit, total}, "objects": [...]}` — paginated on
 * the server side; we exhaust internally via `offset += objects.length` until
 * `offset >= total` (bounded by MAX_PAGES). Careers URLs are subdomain-based
 * (`{slug}.recruiterbox.com`) but the canonical posting lives on
 * `hire.trakstar.com` (the `hosted_url` field).
 *
 * A 400 with `{"client_name": "Invalid client name"}` (and 404) means the slug
 * isn't a Recruiterbox tenant → treated as CompanyNotFound (throw with status,
 * matching how other adapters treat 404). A 200 with `meta.total == 0` is a
 * valid empty tenant.
 */

const PAGE_LIMIT = 100
const MAX_PAGES = 50

type RBLocation = {
  city?: string
  state?: string
  country?: string
  zipcode?: string
}

type RBOpening = {
  id?: number | string
  title?: string
  hosted_url?: string
  url?: string
  location?: RBLocation
  allows_remote?: boolean
  position_type?: string
  team?: string
  created_on?: string
  updated_on?: string
  client_name?: string
}

type RBResponse = {
  meta?: { offset?: number; limit?: number; total?: number }
  objects?: RBOpening[]
}

function listingUrl(slug: string, offset: number): string {
  const safe = encodeURIComponent(slug)
  return `https://jsapi.recruiterbox.com/v1/openings?client_name=${safe}&offset=${offset}&limit=${PAGE_LIMIT}`
}

function detectFromUrl(url: string): { slug: string } | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  const host = parsed.hostname.toLowerCase()
  const m = host.match(/^([a-z0-9-]+)\.recruiterbox\.com$/)
  if (!m) return null
  const slug = m[1]
  if (slug === "www" || slug === "app" || slug === "api" || slug === "jsapi") return null
  return { slug }
}

function pickLocation(loc: RBLocation | undefined): string | undefined {
  if (!loc) return undefined
  const parts = [loc.city, loc.state, loc.country]
    .map((p) => p?.trim())
    .filter((p): p is string => Boolean(p))
  return parts.length ? parts.join(", ") : undefined
}

function mapRawJob(raw: RBOpening): HarvestedJob | null {
  const id = raw.id != null ? String(raw.id).trim() : ""
  const title = raw.title?.trim()
  const applyUrl = raw.hosted_url?.trim() || raw.url?.trim()
  if (!id || !title || !applyUrl) return null

  const location = pickLocation(raw.location)
  const postedAt = raw.created_on ?? raw.updated_on ?? undefined
  const employmentType = raw.position_type?.trim() || undefined
  const workMode = raw.allows_remote ? "remote" : undefined

  const contentHash = hashContent([
    title,
    applyUrl,
    location,
    postedAt,
    workMode,
    employmentType,
  ])

  return {
    externalId: `recruiterbox:${id}`,
    title,
    applyUrl,
    location,
    postedAt,
    workMode,
    employmentType,
    contentHash,
  }
}

function fetchPage(
  slug: string,
  offset: number,
  ctx: HarvestCtx
): ReturnType<typeof conditionalFetchJson<RBResponse>> {
  return conditionalFetchJson<RBResponse>(listingUrl(slug, offset), ctx)
}

export const recruiterboxAdapter: AtsAdapter = {
  name: "recruiterbox",
  concurrency: envConcurrency("recruiterbox", 6),
  detectFromUrl,
  async fetchJobs({ slug, ctx }): Promise<HarvestResult> {
    const fetchedAt = new Date()

    // Page 1 carries the conditional headers. A 400 "Invalid client name" or
    // 404 on the first page means the slug isn't a tenant — throw with status
    // so the caller can treat it as CompanyNotFound, like the other adapters.
    const first = await fetchPage(slug, 0, ctx)

    if (first.kind === "not_modified") {
      return {
        jobs: [],
        notModified: true,
        etag: first.etag,
        lastModified: first.lastModified,
        sourceAts: "recruiterbox",
        sourceAtsSlug: slug,
        fetchedAt,
        upstreamLatencyMs: first.upstreamLatencyMs,
      }
    }
    if (first.kind === "error") {
      const err = new Error(`recruiterbox fetch failed: ${first.reason}`)
      ;(err as Error & { status?: number | null }).status = first.status
      throw err
    }

    const seen = new Set<string>()
    const jobs: HarvestedJob[] = []
    const collect = (objects: RBOpening[] | undefined) => {
      for (const raw of objects ?? []) {
        const mapped = mapRawJob(raw)
        if (!mapped || seen.has(mapped.externalId)) continue
        seen.add(mapped.externalId)
        jobs.push(mapped)
      }
    }

    const firstObjects = first.data?.objects ?? []
    collect(firstObjects)
    const total = first.data?.meta?.total
    let upstreamLatency = first.upstreamLatencyMs

    let offset = firstObjects.length
    let pageCount = 1
    while (
      firstObjects.length > 0 &&
      (total == null || offset < total) &&
      pageCount < MAX_PAGES
    ) {
      const next = await fetchPage(slug, offset, {
        ...ctx,
        etag: null,
        lastModified: null,
      })
      pageCount += 1
      // Only the first page throws; a later-page error just breaks with what
      // we've collected so far.
      if (next.kind !== "ok") break
      const objects = next.data?.objects ?? []
      collect(objects)
      upstreamLatency += next.upstreamLatencyMs
      if (objects.length === 0) break
      offset += objects.length
    }

    return {
      jobs,
      notModified: false,
      etag: first.etag,
      lastModified: first.lastModified,
      sourceAts: "recruiterbox",
      sourceAtsSlug: slug,
      fetchedAt,
      upstreamLatencyMs: upstreamLatency,
    }
  },
}
