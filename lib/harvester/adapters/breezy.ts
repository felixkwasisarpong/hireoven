import pLimit from "p-limit"
import {
  envConcurrency,
  conditionalFetchJson,
  hashContent,
  type AtsAdapter,
  type HarvestCtx,
  type HarvestResult,
  type HarvestedJob,
} from "@/lib/harvester/adapters/_base"
import { fetchHtmlConditional, extractJsonLdBlocks } from "@/lib/harvester/adapters/_json-ld"

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

// The /json listing carries no description — those live on each position's
// public HTML page (raw.url) as a schema.org/JobPosting JSON-LD block. Without
// this, every breezy job shipped with an empty description. Bounded like the
// gem/oracle detail phases so a large board can't blow the per-company budget.
function intEnv(name: string, dflt: number, min = 0): number {
  const n = Number.parseInt(process.env[name] ?? "", 10)
  return Number.isFinite(n) && n >= min ? n : dflt
}
const DETAIL_MAX_JOBS = intEnv("HARVESTER_BREEZY_DETAIL_MAX_JOBS", 200, 0)
const DETAIL_CONCURRENCY = intEnv("HARVESTER_BREEZY_DETAIL_CONCURRENCY", 4, 1)

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

function descriptionFromJsonLd(html: string): string | undefined {
  for (const block of extractJsonLdBlocks(html)) {
    const items = Array.isArray(block) ? block : [block]
    for (const item of items) {
      if (!item || typeof item !== "object") continue
      const type = (item as { "@type"?: unknown })["@type"]
      const isJob = type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"))
      if (!isJob) continue
      const desc = (item as { description?: unknown }).description
      if (typeof desc === "string") return stripHtml(desc)
    }
  }
  return undefined
}

async function enrichWithDescriptions(jobs: HarvestedJob[], ctx: HarvestCtx): Promise<void> {
  if (DETAIL_MAX_JOBS === 0) return
  const targets = jobs.filter((j) => !j.description && j.applyUrl).slice(0, DETAIL_MAX_JOBS)
  if (targets.length === 0) return

  const limiter = pLimit(DETAIL_CONCURRENCY)
  await Promise.all(
    targets.map((job) =>
      limiter(async () => {
        const res = await fetchHtmlConditional(job.applyUrl, { ...ctx, etag: null, lastModified: null }, { maxAttempts: 2 })
        if (res.kind !== "ok") return
        const description = descriptionFromJsonLd(res.html)
        if (!description) return
        job.description = description
        job.contentHash = hashContent([
          job.title,
          job.applyUrl,
          job.location,
          job.postedAt,
          job.workMode,
          job.employmentType,
          description.slice(0, 4_000),
        ])
      })
    )
  )
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

    // The /json listing has no description — fetch each position's JSON-LD.
    await enrichWithDescriptions(jobs, ctx)

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
