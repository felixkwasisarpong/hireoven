import {
  envConcurrency,
  conditionalFetchJson,
  hashContent,
  type AtsAdapter,
  type HarvestResult,
  type HarvestedJob,
} from "@/lib/harvester/adapters/_base"

/**
 * Recruitee public Offers API.
 *   https://{slug}.recruitee.com/api/offers/
 * Subdomain-based ATS — slug is the leftmost label.
 */

type RecruiteeOffer = {
  id?: number | string
  slug?: string
  title?: string
  description?: string
  requirements?: string
  careers_apply_url?: string
  careers_url?: string
  url?: string
  created_at?: string
  published_at?: string
  location?: string
  city?: string
  country_code?: string
  department?: string
  employment_type_code?: string
  remote?: boolean
  status?: string
}

type RecruiteeResponse = {
  offers?: RecruiteeOffer[]
}

function endpointFor(slug: string): string {
  return `https://${encodeURIComponent(slug)}.recruitee.com/api/offers/`
}

function detectFromUrl(url: string): { slug: string } | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  const host = parsed.hostname.toLowerCase()
  const m = host.match(/^([a-z0-9-]+)\.recruitee\.com$/)
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

function pickLocation(raw: RecruiteeOffer): string | undefined {
  if (raw.location?.trim()) return raw.location.trim()
  const parts = [raw.city, raw.country_code].map((p) => p?.trim()).filter(Boolean)
  return parts.length ? parts.join(", ") : undefined
}

function buildApplyUrl(slug: string, raw: RecruiteeOffer): string {
  return (
    raw.careers_apply_url?.trim() ||
    raw.careers_url?.trim() ||
    raw.url?.trim() ||
    `https://${slug}.recruitee.com/o/${raw.slug ?? raw.id ?? ""}`
  )
}

function mapRawJob(slug: string, raw: RecruiteeOffer): HarvestedJob | null {
  if (!raw.id || !raw.title) return null
  if (raw.status && raw.status.toLowerCase() !== "published") return null

  const description = [stripHtml(raw.description), stripHtml(raw.requirements)]
    .filter((s): s is string => Boolean(s))
    .join("\n\n") || undefined
  const location = pickLocation(raw)
  const postedAt = raw.published_at ?? raw.created_at ?? undefined
  const workMode = raw.remote ? "remote" : undefined
  const applyUrl = buildApplyUrl(slug, raw)

  const contentHash = hashContent([
    raw.title,
    applyUrl,
    location,
    postedAt,
    workMode,
    raw.employment_type_code,
    description?.slice(0, 4_000),
  ])

  return {
    externalId: `recruitee:${raw.id}`,
    title: raw.title.trim(),
    applyUrl,
    description,
    location,
    postedAt,
    workMode,
    employmentType: raw.employment_type_code ?? undefined,
    contentHash,
  }
}

export const recruiteeAdapter: AtsAdapter = {
  name: "recruitee",
  concurrency: envConcurrency("recruitee", 8),
  detectFromUrl,
  async fetchJobs({ slug, ctx }): Promise<HarvestResult> {
    const fetchedAt = new Date()
    const result = await conditionalFetchJson<RecruiteeResponse>(endpointFor(slug), ctx)

    if (result.kind === "not_modified") {
      return {
        jobs: [],
        notModified: true,
        etag: result.etag,
        lastModified: result.lastModified,
        sourceAts: "recruitee",
        sourceAtsSlug: slug,
        fetchedAt,
        upstreamLatencyMs: result.upstreamLatencyMs,
      }
    }
    if (result.kind === "error") {
      const err = new Error(`recruitee fetch failed: ${result.reason}`)
      ;(err as Error & { status?: number | null }).status = result.status
      throw err
    }

    const offers = result.data?.offers ?? []
    const jobs: HarvestedJob[] = []
    for (const raw of offers) {
      const mapped = mapRawJob(slug, raw)
      if (mapped) jobs.push(mapped)
    }

    return {
      jobs,
      notModified: false,
      etag: result.etag,
      lastModified: result.lastModified,
      sourceAts: "recruitee",
      sourceAtsSlug: slug,
      fetchedAt,
      upstreamLatencyMs: result.upstreamLatencyMs,
    }
  },
}
