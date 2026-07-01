import {
  envConcurrency,
  conditionalFetchJson,
  hashContent,
  type AtsAdapter,
  type HarvestResult,
  type HarvestedJob,
} from "@/lib/harvester/adapters/_base"

/**
 * Pinpoint public postings API.
 *   https://{slug}.pinpointhq.com/postings.json
 * Subdomain-based ATS — slug is the leftmost label. Single payload, no pagination.
 */

type PinpointLocation = {
  city?: string
  name?: string
  province?: string
  country?: string
}

type PinpointPosting = {
  id?: number | string
  title?: string
  url?: string
  location?: PinpointLocation
  workplace_type?: string
  employment_type?: string
  description?: string
  reference?: string
  first_published_at?: string
  published_at?: string
}

type PinpointResponse = {
  data?: PinpointPosting[]
}

// Pinpoint sometimes prefixes the employment-type code with the contract
// status (`permanent_full_time`, `fixed_term_part_time`…). We try the full
// string, then strip known prefixes, then fall back to a substring match.
const TYPE_MAP: Record<string, string> = {
  full_time: "FULL_TIME",
  part_time: "PART_TIME",
  contract: "CONTRACT",
  fixed_term: "CONTRACT",
  fixed_term_full_time: "CONTRACT",
  fixed_term_part_time: "CONTRACT",
  freelance: "CONTRACT",
  intern: "INTERN",
  internship: "INTERN",
  trainee: "INTERN",
  apprentice: "INTERN",
  apprenticeship: "INTERN",
  temporary: "TEMPORARY",
  casual: "TEMPORARY",
  seasonal: "TEMPORARY",
  permanent_full_time: "FULL_TIME",
  permanent_part_time: "PART_TIME",
  permanent: "FULL_TIME",
}

function endpointFor(slug: string): string {
  return `https://${encodeURIComponent(slug)}.pinpointhq.com/postings.json`
}

function detectFromUrl(url: string): { slug: string } | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  const host = parsed.hostname.toLowerCase()
  const m = host.match(/^([a-z0-9-]+)\.pinpointhq\.com$/)
  if (!m) return null
  const slug = m[1]
  if (slug === "www" || slug === "app" || slug === "api") return null
  return { slug }
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

function pickLocation(raw: PinpointPosting): string | undefined {
  const loc = raw.location
  if (!loc) return undefined
  // `name` is the user-visible label ("Remote", "London, UK") — prefer it.
  if (loc.name?.trim()) return loc.name.trim()
  const parts = [loc.city, loc.province, loc.country]
    .map((p) => p?.trim())
    .filter(Boolean)
  return parts.length ? parts.join(", ") : undefined
}

function pickWorkMode(raw: PinpointPosting): string | undefined {
  const wt = raw.workplace_type?.trim().toLowerCase()
  if (!wt) return undefined
  if (wt === "remote") return "remote"
  if (wt === "hybrid") return "hybrid"
  if (wt === "onsite" || wt === "on_site" || wt === "office") return "onsite"
  return undefined
}

function mapEmploymentType(value: string | undefined): string | undefined {
  const norm = value?.trim().toLowerCase()
  if (!norm) return undefined
  if (TYPE_MAP[norm]) return TYPE_MAP[norm]
  for (const prefix of ["permanent_", "fixed_term_", "regular_"]) {
    if (norm.startsWith(prefix)) {
      const tail = norm.slice(prefix.length)
      if (TYPE_MAP[tail]) return TYPE_MAP[tail]
    }
  }
  for (const needle of Object.keys(TYPE_MAP)) {
    if (norm.includes(needle)) return TYPE_MAP[needle]
  }
  return undefined
}

function mapRawJob(raw: PinpointPosting): HarvestedJob | null {
  if (!raw.id || !raw.title || !raw.url) return null

  const applyUrl = raw.url.trim()
  const title = raw.title.trim()
  const description = stripHtml(raw.description)
  const location = pickLocation(raw)
  const workMode = pickWorkMode(raw)
  const employmentType = mapEmploymentType(raw.employment_type)
  const postedAt = raw.first_published_at ?? raw.published_at ?? undefined

  const contentHash = hashContent([
    title,
    applyUrl,
    location,
    postedAt,
    workMode,
    employmentType,
    description?.slice(0, 4_000),
  ])

  return {
    externalId: `pinpoint:${raw.id}`,
    title,
    applyUrl,
    description,
    location,
    postedAt,
    workMode,
    employmentType,
    contentHash,
  }
}

export const pinpointAdapter: AtsAdapter = {
  name: "pinpoint",
  concurrency: envConcurrency("pinpoint", 6),
  detectFromUrl,
  async fetchJobs({ slug, ctx }): Promise<HarvestResult> {
    const fetchedAt = new Date()
    const result = await conditionalFetchJson<PinpointResponse>(endpointFor(slug), ctx)

    if (result.kind === "not_modified") {
      return {
        jobs: [],
        notModified: true,
        etag: result.etag,
        lastModified: result.lastModified,
        sourceAts: "pinpoint",
        sourceAtsSlug: slug,
        fetchedAt,
        upstreamLatencyMs: result.upstreamLatencyMs,
      }
    }
    if (result.kind === "error") {
      const err = new Error(`pinpoint fetch failed: ${result.reason}`)
      ;(err as Error & { status?: number | null }).status = result.status
      throw err
    }

    const postings = Array.isArray(result.data?.data) ? result.data.data : []
    const jobs: HarvestedJob[] = []
    for (const raw of postings) {
      const mapped = mapRawJob(raw)
      if (mapped) jobs.push(mapped)
    }

    return {
      jobs,
      notModified: false,
      etag: result.etag,
      lastModified: result.lastModified,
      sourceAts: "pinpoint",
      sourceAtsSlug: slug,
      fetchedAt,
      upstreamLatencyMs: result.upstreamLatencyMs,
    }
  },
}
