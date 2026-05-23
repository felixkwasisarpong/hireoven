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

/**
 * SmartRecruiters public posting API.
 * https://api.smartrecruiters.com/v1/companies/{slug}/postings?offset=N&limit=100
 *
 * Pagination via offset/limit. The list endpoint does NOT return job
 * descriptions — `jobAd.sections.*` is only on the per-posting detail
 * endpoint `/v1/companies/{slug}/postings/{id}`. We fetch a bounded subset
 * of detail records per cycle (newest first) to enrich descriptions; the
 * remainder ship as listing-only and get filled in on subsequent cycles.
 */

const PAGE_LIMIT = 100
const MAX_PAGES = 20
// Bumped 60 → 250. SR detail endpoint is fast (~150-300ms each); at
// concurrency 6, 250 jobs takes ~10s of detail time, well under the 240s
// lease. Previous cap left 50%+ of SR rows description-less because the
// list endpoint alone has no jobAd.sections.* payload.
const DETAIL_MAX_JOBS = Math.max(
  0,
  Number.parseInt(process.env.HARVESTER_SR_DETAIL_MAX_JOBS ?? "250", 10)
)
const DETAIL_CONCURRENCY = Math.max(
  1,
  Number.parseInt(process.env.HARVESTER_SR_DETAIL_CONCURRENCY ?? "6", 10)
)

type SRSection = { text?: string }

type SRJobAd = {
  sections?: {
    companyDescription?: SRSection
    jobDescription?: SRSection
    qualifications?: SRSection
    additionalInformation?: SRSection
  }
}

type SRLocation = {
  city?: string
  region?: string
  country?: string
  remote?: boolean
  fullLocation?: string
}

type SRPosting = {
  id?: string
  refNumber?: string
  name?: string
  uuid?: string
  location?: SRLocation
  releasedDate?: string
  createdOn?: string
  updatedOn?: string
  typeOfEmployment?: { id?: string; label?: string }
  experienceLevel?: { id?: string; label?: string }
  customField?: Array<{ fieldId?: string; fieldLabel?: string; valueId?: string; valueLabel?: string }>
  jobAd?: SRJobAd
  ref?: string
  postingUrl?: string
  company?: { identifier?: string }
}

type SRPostingsResponse = {
  offset?: number
  limit?: number
  totalFound?: number
  content?: SRPosting[]
}

function listingUrl(slug: string, offset: number): string {
  const safe = encodeURIComponent(slug)
  return `https://api.smartrecruiters.com/v1/companies/${safe}/postings?offset=${offset}&limit=${PAGE_LIMIT}`
}

function detailUrl(slug: string, postingId: string): string {
  return `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(slug)}/postings/${encodeURIComponent(postingId)}`
}

function detectFromUrl(url: string): { slug: string } | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  const host = parsed.hostname.toLowerCase()
  if (host !== "jobs.smartrecruiters.com" && host !== "careers.smartrecruiters.com") return null
  const slug = parsed.pathname.split("/").filter(Boolean)[0]
  if (!slug) return null
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(slug)) return null
  return { slug }
}

function flattenLocation(loc: SRLocation | undefined): string | undefined {
  if (!loc) return undefined
  if (loc.fullLocation?.trim()) return loc.fullLocation.trim()
  const parts = [loc.city, loc.region, loc.country].map((p) => p?.trim()).filter(Boolean)
  if (parts.length) return parts.join(", ")
  return undefined
}

function buildDescription(jobAd: SRJobAd | undefined): string | undefined {
  if (!jobAd?.sections) return undefined
  const segments = [
    jobAd.sections.companyDescription?.text,
    jobAd.sections.jobDescription?.text,
    jobAd.sections.qualifications?.text,
    jobAd.sections.additionalInformation?.text,
  ]
    .map((text) => text?.trim())
    .filter((text): text is string => Boolean(text))
  if (segments.length === 0) return undefined
  return segments.join("\n\n")
}

function publicApplyUrl(slug: string, postingId: string | undefined): string {
  return `https://jobs.smartrecruiters.com/${encodeURIComponent(slug)}/${encodeURIComponent(postingId ?? "")}`
}

type SRMapped = HarvestedJob & { postingId: string }

function mapRawJob(slug: string, raw: SRPosting): SRMapped | null {
  const id = raw.id ?? raw.uuid ?? raw.refNumber ?? raw.ref
  if (!id || !raw.name) return null

  const applyUrl = raw.postingUrl?.trim() || publicApplyUrl(slug, id)
  const description = buildDescription(raw.jobAd)
  const location = flattenLocation(raw.location)
  const postedAt = raw.releasedDate ?? raw.createdOn ?? raw.updatedOn ?? undefined
  const employmentType = raw.typeOfEmployment?.label ?? raw.typeOfEmployment?.id ?? undefined
  const workMode = raw.location?.remote ? "remote" : undefined

  const contentHash = hashContent([
    raw.name,
    applyUrl,
    location,
    postedAt,
    workMode,
    employmentType,
    description?.slice(0, 4_000),
  ])

  return {
    externalId: `smartrecruiters:${id}`,
    title: raw.name.trim(),
    applyUrl,
    description,
    location,
    postedAt,
    workMode,
    employmentType,
    contentHash,
    postingId: String(id),
  }
}

/**
 * Enrich a bounded subset of jobs with descriptions from the per-posting
 * detail endpoint. Mutates the array in place. Most recent jobs first.
 */
async function enrichDescriptions(
  slug: string,
  jobs: SRMapped[],
  ctx: HarvestCtx
): Promise<void> {
  if (DETAIL_MAX_JOBS === 0) return
  // Skip jobs already known to have a real description in the DB — keeps the
  // per-cycle budget focused on jobs that still need one.
  const alreadyDescribed = ctx.alreadyDescribedIds
  const targets = jobs
    .filter((j) => !j.description || j.description.length < 300)
    .filter((j) => !alreadyDescribed?.has(j.externalId))
    .slice(0, DETAIL_MAX_JOBS)
  if (targets.length === 0) return

  const limiter = pLimit(DETAIL_CONCURRENCY)
  await Promise.all(
    targets.map((job) =>
      limiter(async () => {
        const detail = await conditionalFetchJson<SRPosting>(detailUrl(slug, job.postingId), {
          ...ctx,
          etag: null,
          lastModified: null,
        })
        if (detail.kind !== "ok" || !detail.data) return
        const desc = buildDescription(detail.data.jobAd)
        if (!desc || desc.length <= (job.description?.length ?? 0)) return
        job.description = desc
        job.contentHash = hashContent([
          job.title,
          job.applyUrl,
          job.location,
          job.postedAt,
          job.workMode,
          job.employmentType,
          desc.slice(0, 4_000),
        ])
      })
    )
  )
}

async function fetchSingle(
  slug: string,
  offset: number,
  ctx: HarvestCtx
): ReturnType<typeof conditionalFetchJson<SRPostingsResponse>> {
  return conditionalFetchJson<SRPostingsResponse>(listingUrl(slug, offset), ctx)
}

export const smartrecruitersAdapter: AtsAdapter = {
  name: "smartrecruiters",
  // Paginated, ~600ms per page; lower cap to avoid hitting their rate limits.
  concurrency: envConcurrency("smartrecruiters", 6),
  detectFromUrl,
  async fetchJobs({ slug, ctx }): Promise<HarvestResult> {
    const fetchedAt = new Date()

    // Page 1 carries the conditional headers — change to any posting almost
    // always reorders/touches the first page, so 304 on page 1 lets us skip.
    const first = await fetchSingle(slug, 0, ctx)

    if (first.kind === "not_modified") {
      return {
        jobs: [],
        notModified: true,
        etag: first.etag,
        lastModified: first.lastModified,
        sourceAts: "smartrecruiters",
        sourceAtsSlug: slug,
        fetchedAt,
        upstreamLatencyMs: first.upstreamLatencyMs,
      }
    }
    if (first.kind === "error") {
      const err = new Error(`smartrecruiters fetch failed: ${first.reason}`)
      ;(err as Error & { status?: number | null }).status = first.status
      throw err
    }

    const jobs: SRMapped[] = []
    const collect = (postings: SRPosting[] | undefined) => {
      for (const raw of postings ?? []) {
        const mapped = mapRawJob(slug, raw)
        if (mapped) jobs.push(mapped)
      }
    }

    collect(first.data?.content)
    const totalFound = first.data?.totalFound ?? jobs.length
    let upstreamLatency = first.upstreamLatencyMs

    let offset = PAGE_LIMIT
    let pageCount = 1
    while (offset < totalFound && pageCount < MAX_PAGES) {
      const next = await fetchSingle(slug, offset, {
        ...ctx,
        etag: null,
        lastModified: null,
      })
      pageCount += 1
      if (next.kind !== "ok") break
      collect(next.data?.content)
      upstreamLatency += next.upstreamLatencyMs
      if ((next.data?.content?.length ?? 0) === 0) break
      offset += PAGE_LIMIT
    }

    const enrichStarted = Date.now()
    await enrichDescriptions(slug, jobs, ctx)
    upstreamLatency += Date.now() - enrichStarted

    // Strip the internal postingId field before returning — it's not part
    // of the HarvestedJob contract.
    const out: HarvestedJob[] = jobs.map(({ postingId: _postingId, ...rest }) => rest)

    return {
      jobs: out,
      notModified: false,
      etag: first.etag,
      lastModified: first.lastModified,
      sourceAts: "smartrecruiters",
      sourceAtsSlug: slug,
      fetchedAt,
      upstreamLatencyMs: upstreamLatency,
    }
  },
}
