import {
  conditionalFetchJson,
  envConcurrency,
  hashContent,
  type AtsAdapter,
  type HarvestCtx,
  type HarvestResult,
  type HarvestedJob,
} from "@/lib/harvester/adapters/_base"

/**
 * BambooHR public careers board.
 *   list:   https://{slug}.bamboohr.com/careers/list        → JSON job list
 *   detail: https://{slug}.bamboohr.com/careers/{id}/detail → JSON (description)
 *
 * The rendered /careers page is a JS SPA with NO server-side JSON-LD, so HTML
 * scraping returns zero jobs. The /careers/list + /careers/{id}/detail JSON
 * endpoints that back the SPA are stable and return the real openings, so we
 * page the list then fill descriptions from a bounded set of detail fetches.
 */

// Descriptions come from per-job detail fetches; cap them per cycle so a large
// board can't blow the lease, and lean on alreadyDescribedIds to spend the
// budget on jobs that still need a description.
const DETAIL_MAX_JOBS = 100
const DETAIL_CONCURRENCY = 4

type BambooListJob = {
  id?: string | number
  jobOpeningName?: string
  employmentStatusLabel?: string | null
  location?: { city?: string | null; state?: string | null } | null
  atsLocation?: {
    country?: string | null
    state?: string | null
    province?: string | null
    city?: string | null
  } | null
  isRemote?: boolean | null
}

type BambooListResponse = {
  meta?: { totalCount?: number }
  result?: BambooListJob[]
}

type BambooDetailResponse = {
  result?: {
    jobOpening?: {
      description?: string | null
      jobOpeningShareUrl?: string | null
    }
  }
}

function listUrl(slug: string): string {
  return `https://${encodeURIComponent(slug)}.bamboohr.com/careers/list`
}

function detailUrl(slug: string, id: string): string {
  return `https://${encodeURIComponent(slug)}.bamboohr.com/careers/${encodeURIComponent(id)}/detail`
}

function applyUrlFor(slug: string, id: string): string {
  return `https://${slug}.bamboohr.com/careers/${id}`
}

function detectFromUrl(url: string): { slug: string } | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  const host = parsed.hostname.toLowerCase()
  const m = host.match(/^([a-z0-9-]+)\.bamboohr\.com$/)
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
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  return text || undefined
}

function buildLocation(raw: BambooListJob): string | undefined {
  const ats = raw.atsLocation ?? {}
  const loc = raw.location ?? {}
  const parts = [
    ats.city ?? loc.city,
    ats.state ?? ats.province ?? loc.state,
    ats.country,
  ]
    .map((p) => (typeof p === "string" ? p.trim() : ""))
    .filter(Boolean)
  return parts.length ? parts.join(", ") : undefined
}

function contentHashFor(raw: BambooListJob, location: string | undefined, description: string | undefined): string {
  return hashContent([
    raw.jobOpeningName,
    location,
    raw.employmentStatusLabel,
    raw.isRemote ? "remote" : "",
    description,
  ])
}

function shallowJob(slug: string, raw: BambooListJob): HarvestedJob | null {
  const id = raw.id == null ? "" : String(raw.id).trim()
  const title = raw.jobOpeningName?.trim()
  if (!id || !title) return null
  const location = buildLocation(raw)
  return {
    externalId: `bamboohr:${slug}:${id}`,
    title,
    applyUrl: applyUrlFor(slug, id),
    location,
    employmentType: raw.employmentStatusLabel?.trim() || undefined,
    workMode: raw.isRemote ? "remote" : undefined,
    contentHash: contentHashFor(raw, location, undefined),
  }
}

async function fetchDescription(
  slug: string,
  id: string,
  ctx: HarvestCtx
): Promise<string | undefined> {
  const result = await conditionalFetchJson<BambooDetailResponse>(detailUrl(slug, id), {
    ...ctx,
    etag: null,
    lastModified: null,
  })
  if (result.kind !== "ok") return undefined
  return stripHtml(result.data?.result?.jobOpening?.description)
}

async function enrichWithDetails(
  slug: string,
  base: Array<{ raw: BambooListJob; job: HarvestedJob }>,
  ctx: HarvestCtx
): Promise<HarvestedJob[]> {
  const alreadyDescribed = ctx.alreadyDescribedIds
  const targets = base
    .filter(({ job }) => !alreadyDescribed?.has(job.externalId))
    .slice(0, DETAIL_MAX_JOBS)
  const described = new Map<string, HarvestedJob>()
  let cursor = 0
  await Promise.all(
    Array.from({ length: Math.min(DETAIL_CONCURRENCY, targets.length) }, async () => {
      while (true) {
        const idx = cursor++
        if (idx >= targets.length) return
        const { raw, job } = targets[idx]
        const id = String(raw.id).trim()
        const description = await fetchDescription(slug, id, ctx)
        if (description) {
          described.set(job.externalId, {
            ...job,
            description,
            contentHash: contentHashFor(raw, job.location, description),
          })
        }
      }
    })
  )
  return base.map(({ job }) => described.get(job.externalId) ?? job)
}

export const bamboohrAdapter: AtsAdapter = {
  name: "bamboohr",
  // Per-customer host (slug.bamboohr.com) so contention across companies is low.
  concurrency: envConcurrency("bamboohr", 6),
  detectFromUrl,
  async fetchJobs({ slug, ctx }): Promise<HarvestResult> {
    const fetchedAt = new Date()
    const result = await conditionalFetchJson<BambooListResponse>(listUrl(slug), ctx)

    if (result.kind === "not_modified") {
      return {
        jobs: [],
        notModified: true,
        etag: result.etag,
        lastModified: result.lastModified,
        sourceAts: "bamboohr",
        sourceAtsSlug: slug,
        fetchedAt,
        upstreamLatencyMs: result.upstreamLatencyMs,
      }
    }
    if (result.kind === "error") {
      const err = new Error(`bamboohr fetch failed: ${result.reason}`)
      ;(err as Error & { status?: number | null }).status = result.status
      throw err
    }

    const base: Array<{ raw: BambooListJob; job: HarvestedJob }> = []
    for (const raw of result.data?.result ?? []) {
      const job = shallowJob(slug, raw)
      if (job) base.push({ raw, job })
    }

    const jobs = base.length === 0 ? [] : await enrichWithDetails(slug, base, ctx)

    return {
      jobs,
      notModified: false,
      etag: result.etag,
      lastModified: result.lastModified,
      sourceAts: "bamboohr",
      sourceAtsSlug: slug,
      fetchedAt,
      upstreamLatencyMs: result.upstreamLatencyMs,
    }
  },
}
