import {
  envConcurrency,
  conditionalFetchJson,
  hashContent,
  type AtsAdapter,
  type HarvestResult,
  type HarvestedJob,
} from "@/lib/harvester/adapters/_base"

/**
 * Ashby public Job Board API.
 * https://api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=true
 *
 * Returns { apiVersion, jobs: [...] }. We skip postings with isListed === false
 * (drafts / unpublished). Compensation is opt-in via the query param.
 */

type AshbyAddress = {
  postalAddress?: {
    addressLocality?: string
    addressRegion?: string
    addressCountry?: string
  }
}

type AshbyCompensationTier = {
  currencyCode?: string
  minValue?: number
  maxValue?: number
  interval?: string | null
}

type AshbyCompensation = {
  compensationTierSummary?: string
  compensationTiers?: AshbyCompensationTier[]
}

type AshbyRawJob = {
  id?: string
  title?: string
  location?: string
  locationName?: string
  secondaryLocations?: Array<{ location?: string; locationName?: string }>
  department?: string
  departmentName?: string
  team?: string
  teamName?: string
  isListed?: boolean
  isRemote?: boolean
  workplaceType?: string
  descriptionPlain?: string
  descriptionHtml?: string
  publishedAt?: string
  updatedAt?: string
  employmentType?: string
  address?: AshbyAddress
  jobUrl?: string
  applyUrl?: string
  compensation?: AshbyCompensation
  shouldDisplayCompensationOnJobBoard?: boolean
}

type AshbyResponse = {
  apiVersion?: string
  jobs?: AshbyRawJob[]
}

function endpointFor(slug: string): string {
  return `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}?includeCompensation=true`
}

function detectFromUrl(url: string): { slug: string } | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.hostname.toLowerCase() !== "jobs.ashbyhq.com") return null
  const slug = parsed.pathname.split("/").filter(Boolean)[0]
  if (!slug) return null
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(slug)) return null
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

function flattenAddress(address?: AshbyAddress): string | undefined {
  const a = address?.postalAddress
  if (!a) return undefined
  const parts = [a.addressLocality, a.addressRegion, a.addressCountry]
    .map((p) => p?.trim())
    .filter((p): p is string => Boolean(p))
  return parts.length ? parts.join(", ") : undefined
}

function pickLocation(raw: AshbyRawJob): string | undefined {
  return (
    raw.location?.trim() ||
    raw.locationName?.trim() ||
    flattenAddress(raw.address) ||
    raw.secondaryLocations?.[0]?.location?.trim() ||
    raw.secondaryLocations?.[0]?.locationName?.trim() ||
    undefined
  )
}

function pickAnnualCompensation(comp?: AshbyCompensation): {
  min?: number
  max?: number
  currency?: string
} {
  const tiers = comp?.compensationTiers ?? []
  for (const tier of tiers) {
    if (!tier.minValue || !tier.maxValue) continue
    const interval = (tier.interval ?? "").toLowerCase()
    if (interval && !interval.includes("year") && !interval.includes("annual")) continue
    if (tier.minValue < 10_000 || tier.maxValue < 10_000 || tier.maxValue > 2_000_000) continue
    return {
      min: Math.round(tier.minValue),
      max: Math.round(tier.maxValue),
      currency: tier.currencyCode ?? undefined,
    }
  }
  return {}
}

function mapRawJob(raw: AshbyRawJob): HarvestedJob | null {
  if (!raw?.id || !raw.title) return null
  if (raw.isListed === false) return null

  const applyUrl = raw.applyUrl?.trim() || raw.jobUrl?.trim()
  if (!applyUrl) return null

  const description = raw.descriptionPlain?.trim() || stripHtml(raw.descriptionHtml)
  const location = pickLocation(raw)
  const postedAt = raw.publishedAt ?? raw.updatedAt ?? undefined
  const comp = pickAnnualCompensation(raw.compensation)
  const workMode = raw.isRemote ? "remote" : raw.workplaceType ?? undefined

  const contentHash = hashContent([
    raw.title,
    applyUrl,
    location,
    postedAt,
    workMode,
    raw.employmentType,
    comp.min,
    comp.max,
    comp.currency,
    description?.slice(0, 4_000),
  ])

  return {
    externalId: `ashby:${raw.id}`,
    title: raw.title.trim(),
    applyUrl,
    description,
    location,
    postedAt,
    workMode,
    employmentType: raw.employmentType ?? undefined,
    salaryMin: comp.min,
    salaryMax: comp.max,
    salaryCurrency: comp.currency,
    contentHash,
  }
}

export const ashbyAdapter: AtsAdapter = {
  name: "ashby",
  // Ashby boards are large (3-11 MB JSON). At concurrency 8 the simultaneous
  // gzip-decompress + JSON.parse of several multi-MB bodies is CPU-bound and
  // pushes body-read past the request timeout under load — the dominant source
  // of harvester timeouts (7k+/3d). 4 keeps throughput while cutting contention.
  concurrency: envConcurrency("ashby", 4),
  detectFromUrl,
  async fetchJobs({ slug, ctx }): Promise<HarvestResult> {
    const fetchedAt = new Date()
    // Single attempt — Ashby timeouts are server-slowness, not transient
    // network blips. Retrying a slow API call just multiplies wasted time
    // by the retry count (was burning 3 × 12s ≈ 36s per dead Ashby crawl).
    const result = await conditionalFetchJson<AshbyResponse>(endpointFor(slug), ctx, { maxAttempts: 1 })

    if (result.kind === "not_modified") {
      return {
        jobs: [],
        notModified: true,
        etag: result.etag,
        lastModified: result.lastModified,
        sourceAts: "ashby",
        sourceAtsSlug: slug,
        fetchedAt,
        upstreamLatencyMs: result.upstreamLatencyMs,
      }
    }

    if (result.kind === "error") {
      const err = new Error(`ashby fetch failed: ${result.reason}`)
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
      sourceAts: "ashby",
      sourceAtsSlug: slug,
      fetchedAt,
      upstreamLatencyMs: result.upstreamLatencyMs,
    }
  },
}
