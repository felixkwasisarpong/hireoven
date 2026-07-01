import {
  envConcurrency,
  conditionalFetchJson,
  hashContent,
  type AtsAdapter,
  type HarvestResult,
  type HarvestedJob,
} from "@/lib/harvester/adapters/_base"

/**
 * BreezyHR public positions API.
 *   GET https://{slug}.breezy.hr/json
 *
 * Subdomain-based ATS — slug is the leftmost label. Returns the full array of
 * open positions in one payload (no pagination). Each position carries title,
 * structured location, employment type, published date, and the canonical job
 * URL. Descriptions live behind per-position HTML detail pages (deferred — a
 * backfill can enrich them; the listing already gives everything else).
 *
 * Breezy fronts every tenant on a shared edge that 403-blocks bursty traffic,
 * so keep adapter concurrency modest.
 */

type BreezyLocation = {
  name?: string
  city?: string
  state?: { name?: string }
  country?: { name?: string; id?: string }
  is_remote?: boolean
}

type BreezyType = { id?: string; name?: string }

type BreezyPosition = {
  id?: string
  name?: string
  url?: string
  published_date?: string
  type?: BreezyType
  location?: BreezyLocation
  department?: string
  salary?: string
}

// Breezy's `type.id` is a stable enum.
const EMPLOYMENT_TYPE_MAP: Record<string, string> = {
  fullTime: "FULL_TIME",
  partTime: "PART_TIME",
  contract: "CONTRACT",
  intern: "INTERN",
  internship: "INTERN",
  temporary: "TEMPORARY",
}

function endpointFor(slug: string): string {
  return `https://${encodeURIComponent(slug)}.breezy.hr/json`
}

function detectFromUrl(url: string): { slug: string } | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  const host = parsed.hostname.toLowerCase()
  const m = host.match(/^([a-z0-9-]+)\.breezy\.hr$/)
  if (!m) return null
  const slug = m[1]
  // `breezy.hr` itself and infra subdomains are not tenant boards.
  if (slug === "www" || slug === "app" || slug === "api") return null
  return { slug }
}

function pickLocation(loc: BreezyLocation | undefined): string | undefined {
  if (!loc) return undefined
  // Breezy pre-builds a display `name` ("Baghdad/Erbil, IQ") — prefer it.
  if (loc.name?.trim()) return loc.name.trim()
  const parts = [loc.city, loc.state?.name, loc.country?.name]
    .map((p) => p?.trim())
    .filter((p): p is string => Boolean(p))
  return parts.length ? parts.join(", ") : undefined
}

function mapRawJob(slug: string, raw: BreezyPosition): HarvestedJob | null {
  const externalId = (raw.id ?? "").trim()
  const title = (raw.name ?? "").trim()
  const applyUrl = raw.url?.trim()
  if (!externalId || !title || !applyUrl) return null

  const location = pickLocation(raw.location)
  const postedAt = raw.published_date?.trim() || undefined
  const workMode = raw.location?.is_remote ? "remote" : undefined
  const typeId = raw.type?.id
  const employmentType = typeId ? EMPLOYMENT_TYPE_MAP[typeId] : undefined

  const contentHash = hashContent([
    title,
    applyUrl,
    location,
    postedAt,
    workMode,
    employmentType,
  ])

  return {
    externalId: `breezy:${externalId}`,
    title,
    applyUrl,
    location,
    postedAt,
    workMode,
    employmentType,
    contentHash,
  }
}

export const breezyAdapter: AtsAdapter = {
  name: "breezy",
  // Shared edge 403s on bursts — keep this low (override via
  // HARVESTER_BREEZY_CONCURRENCY if a residential proxy lifts the ceiling).
  concurrency: envConcurrency("breezy", 4),
  detectFromUrl,
  async fetchJobs({ slug, ctx }): Promise<HarvestResult> {
    const fetchedAt = new Date()
    const result = await conditionalFetchJson<BreezyPosition[]>(endpointFor(slug), ctx)

    if (result.kind === "not_modified") {
      return {
        jobs: [],
        notModified: true,
        etag: result.etag,
        lastModified: result.lastModified,
        sourceAts: "breezy",
        sourceAtsSlug: slug,
        fetchedAt,
        upstreamLatencyMs: result.upstreamLatencyMs,
      }
    }
    if (result.kind === "error") {
      const err = new Error(`breezy fetch failed: ${result.reason}`)
      ;(err as Error & { status?: number | null }).status = result.status
      throw err
    }

    // The public endpoint returns a bare array; a non-array body means the
    // tenant has no active careers site (marketing redirect) — treat as empty.
    const positions = Array.isArray(result.data) ? result.data : []
    const jobs: HarvestedJob[] = []
    for (const raw of positions) {
      const mapped = mapRawJob(slug, raw)
      if (mapped) jobs.push(mapped)
    }

    return {
      jobs,
      notModified: false,
      etag: result.etag,
      lastModified: result.lastModified,
      sourceAts: "breezy",
      sourceAtsSlug: slug,
      fetchedAt,
      upstreamLatencyMs: result.upstreamLatencyMs,
    }
  },
}
