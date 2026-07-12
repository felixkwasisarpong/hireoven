import {
  envConcurrency,
  conditionalFetchJson,
  hashContent,
  type AtsAdapter,
  type ConditionalFetchResult,
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
const DETAIL_MAX_JOBS = Math.max(0, Number.parseInt(process.env.HARVESTER_WORKABLE_DETAIL_MAX_JOBS ?? "25", 10))
// 500 ms between detail fetches to avoid triggering Workable's per-IP 429 rate
// limit during the enrichment pass (observed ~1.9k 429s/day at 200 ms).
const DETAIL_DELAY_MS = Math.max(0, Number.parseInt(process.env.HARVESTER_WORKABLE_DETAIL_DELAY_MS ?? "500", 10))
// The list POST is the #1 Workable failure ("workable fetch failed: timeout"):
// it hangs the full per-attempt timeout when the rotating proxy hands us a
// dead/slow residential exit IP. A timed-out attempt destroys its tunnel, so the
// next attempt opens a fresh tunnel = a fresh egress IP. We can't shorten the 20s
// timeout (Workable is genuinely slow under load — 8s once caused 2k+ timeouts/day)
// so more fresh-IP attempts is the lever. 4 * 20s = 80s worst case, comfortably
// inside HARVESTER_WORKABLE_PER_COMPANY_TIMEOUT_MS (180s).
const LIST_MAX_ATTEMPTS = Math.max(1, Number.parseInt(process.env.HARVESTER_WORKABLE_LIST_MAX_ATTEMPTS ?? "4", 10))

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
  // v3 (2026) renamed the work-mode signal to `workplace`: on_site | remote | hybrid.
  workplace?: string
  employment_type?: string
  created_at?: string
  published_on?: string
  // v3 (2026) renamed the publish date from `published_on`/`created_at` to `published`.
  published?: string
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

function fetchWorkableJson<T>(
  url: string,
  ctx: HarvestCtx,
  options: { maxAttempts?: number; method?: "GET" | "POST"; body?: string } = {}
): Promise<ConditionalFetchResult<T>> {
  return conditionalFetchJson<T>(url, ctx, options)
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

function pickWorkMode(raw: WorkableRawJob): string | undefined {
  const wp = raw.workplace?.toLowerCase()
  if (wp === "remote" || raw.telecommuting || raw.remote) return "remote"
  if (wp === "hybrid") return "hybrid"
  return undefined
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
  const postedAt = raw.published_on ?? raw.published ?? raw.created_at ?? undefined
  const workMode = pickWorkMode(raw)

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
  return fetchWorkableJson<WorkableResponse>(listingUrl(slug), ctx, {
    method: "POST",
    body: JSON.stringify(token ? { token } : {}),
    maxAttempts: LIST_MAX_ATTEMPTS,
  })
}

export const workableAdapter: AtsAdapter = {
  name: "workable",
  // apply.workable.com rate-limits per datacenter IP. With the WebShare proxy
  // pool routing each request through a different residential IP, we can raise
  // concurrency safely. Default 3 (overridable via HARVESTER_WORKABLE_CONCURRENCY).
  // Without a proxy this would 429-storm — keep HARVESTER_PROXY_HOSTS containing
  // apply.workable.com whenever this runs above 1.
  concurrency: envConcurrency("workable", 3),
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
        // Jittered delay (base + up to +base) so concurrent Workable workers
        // desynchronise and don't burst apply.workable.com in lockstep.
        if (DETAIL_DELAY_MS > 0) await sleep(DETAIL_DELAY_MS + Math.floor(Math.random() * DETAIL_DELAY_MS))
        const job = targets[i]
        const shortcode = job.externalId.replace(/^workable:/, "")
        const res = await fetchWorkableJson<WorkableRawJob>(
          detailUrl(slug, shortcode),
          { ...ctx, etag: null, lastModified: null },
          { maxAttempts: 2 }
        )
        if (res.kind !== "ok") {
          // Workable rate-limits per IP across the whole board host, so once we
          // see a 429/403 the rest of this pass is doomed — and continuing fires
          // dozens more retried-with-backoff requests, which is exactly what
          // blows the per-company budget into the 300s watchdog and deepens the
          // cluster-wide 429 storm. Stop enriching this crawl; alreadyDescribedIds
          // lets us resume cleanly next time. Other errors: skip just this job.
          if (res.status === 429 || res.status === 403) break
          continue
        }
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
