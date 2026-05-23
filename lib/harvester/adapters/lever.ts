import {
  envConcurrency,
  conditionalFetchJson,
  hashContent,
  type AtsAdapter,
  type HarvestResult,
  type HarvestedJob,
} from "@/lib/harvester/adapters/_base"

/**
 * Lever Postings API (public, unauthenticated).
 * https://api.lever.co/v0/postings/{slug}?mode=json
 *
 * Returns a flat array. Descriptions are split across `description`,
 * `descriptionPlain`, `lists`, `additional`, `additionalPlain` — we concatenate
 * to give downstream a single coherent text blob.
 */

type LeverRawPosting = {
  id: string
  text?: string
  hostedUrl?: string
  description?: string
  descriptionPlain?: string
  additional?: string
  additionalPlain?: string
  lists?: Array<{ text?: string; content?: string }>
  categories?: { location?: string; commitment?: string; department?: string; team?: string }
  createdAt?: number
  workplaceType?: string
  salaryRange?: { min?: number; max?: number; currency?: string; interval?: string }
}

function endpointFor(slug: string): string {
  return `https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`
}

function detectFromUrl(url: string): { slug: string } | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.hostname.toLowerCase() !== "jobs.lever.co") return null
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

function buildDescription(raw: LeverRawPosting): string | undefined {
  const parts: string[] = []
  const opener = raw.descriptionPlain ?? stripHtml(raw.description)
  if (opener) parts.push(opener)
  for (const item of raw.lists ?? []) {
    const heading = item.text?.trim()
    const body = stripHtml(item.content)
    if (heading && body) parts.push(`${heading}\n${body}`)
    else if (body) parts.push(body)
    else if (heading) parts.push(heading)
  }
  const closer = raw.additionalPlain ?? stripHtml(raw.additional)
  if (closer) parts.push(closer)
  const combined = parts.join("\n\n").trim()
  return combined || undefined
}

function annualLeverSalary(
  range: LeverRawPosting["salaryRange"]
): { min: number; max: number; currency: string | undefined } | null {
  if (!range?.min || !range.max) return null
  const interval = range.interval?.toLowerCase() ?? ""
  if (interval && !interval.includes("year") && !interval.includes("annual") && !interval.includes("salary")) {
    return null
  }
  if (range.min < 10_000 || range.max < 10_000 || range.max > 2_000_000) return null
  return {
    min: Math.round(range.min),
    max: Math.round(range.max),
    currency: range.currency ?? undefined,
  }
}

function mapRawJob(raw: LeverRawPosting): HarvestedJob | null {
  if (!raw?.id || !raw.text || !raw.hostedUrl) return null

  const description = buildDescription(raw)
  const location = raw.categories?.location?.trim() || undefined
  const postedAt =
    typeof raw.createdAt === "number" && Number.isFinite(raw.createdAt)
      ? new Date(raw.createdAt).toISOString()
      : undefined
  const salary = annualLeverSalary(raw.salaryRange)

  const contentHash = hashContent([
    raw.text,
    raw.hostedUrl,
    location,
    postedAt,
    raw.workplaceType,
    raw.categories?.commitment,
    salary?.min,
    salary?.max,
    salary?.currency,
    description?.slice(0, 4_000),
  ])

  return {
    externalId: `lever:${raw.id}`,
    title: raw.text.trim(),
    applyUrl: raw.hostedUrl,
    description,
    location,
    postedAt,
    workMode: raw.workplaceType ?? undefined,
    employmentType: raw.categories?.commitment ?? undefined,
    salaryMin: salary?.min,
    salaryMax: salary?.max,
    salaryCurrency: salary?.currency,
    contentHash,
  }
}

export const leverAdapter: AtsAdapter = {
  name: "lever",
  concurrency: envConcurrency("lever", 8),
  detectFromUrl,
  async fetchJobs({ slug, ctx }): Promise<HarvestResult> {
    const fetchedAt = new Date()
    const result = await conditionalFetchJson<LeverRawPosting[]>(endpointFor(slug), ctx)

    if (result.kind === "not_modified") {
      return {
        jobs: [],
        notModified: true,
        etag: result.etag,
        lastModified: result.lastModified,
        sourceAts: "lever",
        sourceAtsSlug: slug,
        fetchedAt,
        upstreamLatencyMs: result.upstreamLatencyMs,
      }
    }

    if (result.kind === "error") {
      const err = new Error(`lever fetch failed: ${result.reason}`)
      ;(err as Error & { status?: number | null }).status = result.status
      throw err
    }

    const payload = result.data ?? []
    const jobs: HarvestedJob[] = []
    for (const raw of payload) {
      const mapped = mapRawJob(raw)
      if (mapped) jobs.push(mapped)
    }

    return {
      jobs,
      notModified: false,
      etag: result.etag,
      lastModified: result.lastModified,
      sourceAts: "lever",
      sourceAtsSlug: slug,
      fetchedAt,
      upstreamLatencyMs: result.upstreamLatencyMs,
    }
  },
}
