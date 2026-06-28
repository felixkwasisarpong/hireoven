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
 * Workable public job board API.
 * https://apply.workable.com/api/v3/accounts/{slug}/jobs
 *
 * Most boards return all jobs in the first response; large boards use page/offset.
 * We probe a small number of pages defensively and stop on empty.
 */

const MAX_PAGES = 10
// Many Workable boards now return an EMPTY description in the list API and serve
// the full JD only from the v2 detail endpoint. Jobs whose list description is
// shorter than this get a (budgeted) detail fetch.
const MIN_LIST_DESC = 300
const DETAIL_MAX_JOBS = Math.max(0, Number.parseInt(process.env.HARVESTER_WORKABLE_DETAIL_MAX_JOBS ?? "50", 10))
const DETAIL_DELAY_MS = Math.max(0, Number.parseInt(process.env.HARVESTER_WORKABLE_DETAIL_DELAY_MS ?? "200", 10))

function detailUrl(slug: string, shortcode: string): string {
  return `https://apply.workable.com/api/v2/accounts/${encodeURIComponent(slug)}/jobs/${encodeURIComponent(shortcode)}`
}
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

type WorkableRawJob = {
  id?: string
  title?: string
  shortcode?: string
  url?: string
  application_url?: string
  description?: string
  requirements?: string
  benefits?: string
  department?: string
  country?: string
  city?: string
  region?: string
  full_location?: string
  location?: { city?: string; region?: string; country?: string } | string
  telecommuting?: boolean
  remote?: boolean
  employment_type?: string
  created_at?: string
  published_on?: string
  state?: string
}

type WorkableResponse = {
  results?: WorkableRawJob[]
  total?: number
  // Workable returns a pagination token under `nextPage` on the POST API.
  // We also accept `next_page` defensively in case the field name varies.
  nextPage?: string | null
  next_page?: string | null
}

function listingUrl(slug: string): string {
  return `https://apply.workable.com/api/v3/accounts/${encodeURIComponent(slug)}/jobs`
}

function detectFromUrl(url: string): { slug: string } | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  const host = parsed.hostname.toLowerCase()
  if (host !== "apply.workable.com" && host !== "jobs.workable.com") return null
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

function pickLocation(raw: WorkableRawJob): string | undefined {
  if (raw.full_location?.trim()) return raw.full_location.trim()
  if (typeof raw.location === "string" && raw.location.trim()) return raw.location.trim()
  const loc = typeof raw.location === "object" ? raw.location : null
  const parts = [
    raw.city ?? loc?.city,
    raw.region ?? loc?.region,
    raw.country ?? loc?.country,
  ]
    .map((p) => p?.trim())
    .filter((p): p is string => Boolean(p))
  return parts.length ? parts.join(", ") : undefined
}

function buildDescription(raw: WorkableRawJob): string | undefined {
  const segments = [
    raw.description,
    raw.requirements,
    raw.benefits,
  ]
    .map((seg) => stripHtml(seg))
    .filter((seg): seg is string => Boolean(seg))
  if (segments.length === 0) return undefined
  return segments.join("\n\n")
}

function mapRawJob(slug: string, raw: WorkableRawJob): HarvestedJob | null {
  if (raw.state && raw.state.toLowerCase() !== "published") return null
  const externalKey = raw.shortcode?.trim() || raw.id?.trim()
  if (!externalKey || !raw.title) return null

  const applyUrl =
    raw.application_url?.trim() ||
    raw.url?.trim() ||
    `https://apply.workable.com/${encodeURIComponent(slug)}/j/${encodeURIComponent(externalKey)}/`
  const description = buildDescription(raw)
  const location = pickLocation(raw)
  const postedAt = raw.published_on ?? raw.created_at ?? undefined
  const workMode = raw.telecommuting || raw.remote ? "remote" : undefined

  const contentHash = hashContent([
    raw.title,
    applyUrl,
    location,
    postedAt,
    workMode,
    raw.employment_type,
    description?.slice(0, 4_000),
  ])

  return {
    externalId: `workable:${externalKey}`,
    title: raw.title.trim(),
    applyUrl,
    description,
    location,
    postedAt,
    workMode,
    employmentType: raw.employment_type ?? undefined,
    contentHash,
  }
}

async function fetchPage(
  slug: string,
  token: string | null,
  ctx: HarvestCtx
): ReturnType<typeof conditionalFetchJson<WorkableResponse>> {
  // Workable flipped this endpoint to POST-only — GET now 404s, and 403s under
  // the harvester's concurrent load. The pagination token rides in the body;
  // an empty body returns page 1.
  return conditionalFetchJson<WorkableResponse>(listingUrl(slug), ctx, {
    method: "POST",
    body: JSON.stringify(token ? { token } : {}),
  })
}

export const workableAdapter: AtsAdapter = {
  name: "workable",
  // apply.workable.com rate-limits hard (429) — and the limit is per-IP, so the
  // 6 in-process workers share one bucket: concurrency 2 means up to 12 parallel
  // requests, which trips it constantly (observed ~850 http_429 / 2k ticks).
  // Dropped to 1 (≤6 cluster-wide) to stop the 429 storm; env-overridable via
  // HARVESTER_WORKABLE_CONCURRENCY.
  concurrency: envConcurrency("workable", 1),
  detectFromUrl,
  async fetchJobs({ slug, ctx }): Promise<HarvestResult> {
    const fetchedAt = new Date()

    const first = await fetchPage(slug, null, ctx)

    if (first.kind === "not_modified") {
      return {
        jobs: [],
        notModified: true,
        etag: first.etag,
        lastModified: first.lastModified,
        sourceAts: "workable",
        sourceAtsSlug: slug,
        fetchedAt,
        upstreamLatencyMs: first.upstreamLatencyMs,
      }
    }
    if (first.kind === "error") {
      const err = new Error(`workable fetch failed: ${first.reason}`)
      ;(err as Error & { status?: number | null }).status = first.status
      throw err
    }

    const jobs: HarvestedJob[] = []
    const collect = (page: WorkableRawJob[] | undefined) => {
      for (const raw of page ?? []) {
        const mapped = mapRawJob(slug, raw)
        if (mapped) jobs.push(mapped)
      }
    }

    collect(first.data?.results)
    let upstreamLatency = first.upstreamLatencyMs

    // Follow the pagination token until it's absent, a page is empty, or we hit
    // the page cap. Small boards return everything on page 1 with no token.
    let token = first.data?.nextPage ?? first.data?.next_page ?? null
    let pages = 1
    while (token && pages < MAX_PAGES) {
      const next = await fetchPage(slug, token, { ...ctx, etag: null, lastModified: null })
      if (next.kind !== "ok") break
      const pageResults = next.data?.results ?? []
      if (pageResults.length === 0) break
      collect(pageResults)
      upstreamLatency += next.upstreamLatencyMs
      token = next.data?.nextPage ?? next.data?.next_page ?? null
      pages += 1
    }

    // Detail-budget pass: boards that omit the JD from the list (e.g. SciTec)
    // serve it from /api/v2/.../jobs/{shortcode}. Fetch it for jobs with a
    // missing/stub list description, skipping ones already well-described in the
    // DB (ctx.alreadyDescribedIds) so the budget goes to jobs that need it.
    if (DETAIL_MAX_JOBS > 0) {
      const targets = jobs
        .filter((j) => (j.description?.length ?? 0) < MIN_LIST_DESC && !ctx.alreadyDescribedIds?.has(j.externalId))
        .slice(0, DETAIL_MAX_JOBS)
      for (let i = 0; i < targets.length; i += 1) {
        if (DETAIL_DELAY_MS > 0) await sleep(DETAIL_DELAY_MS)
        const job = targets[i]
        const shortcode = job.externalId.replace(/^workable:/, "")
        const res = await conditionalFetchJson<WorkableRawJob>(
          detailUrl(slug, shortcode),
          { ...ctx, etag: null, lastModified: null },
          { maxAttempts: 2 }
        )
        if (res.kind !== "ok") continue
        upstreamLatency += res.upstreamLatencyMs
        const full = buildDescription(res.data)
        if (full && full.length > (job.description?.length ?? 0)) {
          job.description = full
          job.contentHash = hashContent([
            job.title, job.applyUrl, job.location, job.postedAt, job.workMode, job.employmentType,
            full.slice(0, 4_000),
          ])
        }
      }
    }

    return {
      jobs,
      notModified: false,
      etag: first.etag,
      lastModified: first.lastModified,
      sourceAts: "workable",
      sourceAtsSlug: slug,
      fetchedAt,
      upstreamLatencyMs: upstreamLatency,
    }
  },
}
