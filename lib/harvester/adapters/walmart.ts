/**
 * Walmart (careers.walmart.com) HTTP adapter.
 *
 * Walmart retired its public Workday board; its current careers site is a custom
 * Next.js app whose only data source is a persisted GraphQL query at
 * `POST /api/graphql`. That query wraps an AI "jobSearchAssistant", BUT the
 * search + pagination are driven by a STRUCTURED context object
 * (`context.job_search_context`, `direct_search:true`) — the chat text is
 * decorative. So we call it directly, headlessly, with no LLM/session cost:
 *
 *   POST /api/graphql  { queryId, variables.chatRequest.context.job_search_context:
 *      { direct_search:true, sort:"newest", job_page:N, filters:"areas IN ['X']" } }
 *   → data.jobSearchAssistant.tool_messages[0].artifact.{ total_jobs, jobs[] }
 *
 * page_size is server-locked at 10 and can't be raised, so we paginate per
 * career area, newest-first, up to a per-area page cap (so a capped crawl always
 * captures the freshest postings). Verified live: works with only UA + accept +
 * content-type, unauthenticated.
 *
 * Tunables:
 *   HARVESTER_WALMART_QUERY_ID          (persisted-query id; override if it rotates)
 *   HARVESTER_WALMART_AREAS             (comma list; default the 5 career areas)
 *   HARVESTER_WALMART_MAX_PAGES_PER_AREA(default 200; 10 jobs/page)
 *   HARVESTER_WALMART_PAGE_DELAY_MS     (default 120)
 * Gated by the walmart per-company timeout (worker.ts).
 */

import {
  conditionalFetchJson,
  envConcurrency,
  hashContent,
  type AtsAdapter,
  type HarvestCtx,
  type HarvestResult,
  type HarvestedJob,
} from "@/lib/harvester/adapters/_base"

const WALMART_HOST_RE = /^https?:\/\/careers\.walmart\.com\//i
const ENDPOINT = "https://careers.walmart.com/api/graphql"
const PAGE_SIZE = 10 // server-locked

function intEnv(name: string, dflt: number, min = 0): number {
  const n = Number.parseInt(process.env[name] ?? "", 10)
  return Number.isFinite(n) && n >= min ? n : dflt
}

const QUERY_ID =
  process.env.HARVESTER_WALMART_QUERY_ID?.trim() || "b0467c1f-f578-4261-9280-0ea4614f251c"
const AREAS = (
  process.env.HARVESTER_WALMART_AREAS ??
  "Corporate,Technology,Healthcare,Supply Chain and Transportation,Stores/Clubs"
)
  .split(",")
  .map((a) => a.trim())
  .filter(Boolean)
const MAX_PAGES_PER_AREA = intEnv("HARVESTER_WALMART_MAX_PAGES_PER_AREA", 200, 1)
const PAGE_DELAY_MS = intEnv("HARVESTER_WALMART_PAGE_DELAY_MS", 120, 0)

type WalmartJob = {
  job_id?: string
  title?: string
  jobPostingTitle?: string
  city?: string
  state?: string
  country?: string
  minPay?: number | null
  maxPay?: number | null
  employmentTypes?: string[]
  jobPostingStartDate?: number | string | null
}

type SearchResponse = {
  data?: {
    jobSearchAssistant?: {
      tool_messages?: Array<{
        artifact?: { total_jobs?: number; jobs?: WalmartJob[] }
      }>
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function threadId(): string {
  let hex = ""
  for (let i = 0; i < 12; i += 1) hex += Math.floor(Math.random() * 16).toString(16)
  return `S-${Date.now()}-${hex}`
}

function buildBody(area: string, page: number): string {
  return JSON.stringify({
    queryId: QUERY_ID,
    variables: {
      chatRequest: {
        messages: [{ role: "user", content: [{ type: "text", text: "jobs" }] }],
        thread_id: threadId(),
        channel: "job_search",
        context: {
          job_search_context: {
            refined_query: "jobId == '*'",
            direct_search: true,
            locale: "en_US",
            sort: "newest",
            active_tab: "jobs",
            management_levels: [],
            content_page: 0,
            future_roles_page: 0,
            job_page: page,
            filters: area ? `areas IN ['${area}']` : "",
          },
        },
      },
    },
  })
}

function artifactOf(res: SearchResponse): { total: number; jobs: WalmartJob[] } {
  const art = res.data?.jobSearchAssistant?.tool_messages?.[0]?.artifact
  return { total: art?.total_jobs ?? 0, jobs: art?.jobs ?? [] }
}

function toPostedAt(v: WalmartJob["jobPostingStartDate"]): string | undefined {
  if (v == null) return undefined
  const ms = typeof v === "number" ? v : Number(v)
  if (!Number.isFinite(ms)) return undefined
  const d = new Date(ms)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}

export function mapJob(job: WalmartJob): HarvestedJob | null {
  const id = (job.job_id ?? "").trim()
  const title = (job.title || job.jobPostingTitle || "").trim()
  if (!id || !title) return null
  const applyUrl = `https://careers.walmart.com/us/en/job/${encodeURIComponent(id)}`
  const location = [job.city, job.state].filter(Boolean).join(", ") || undefined
  const salaryMin = typeof job.minPay === "number" && job.minPay > 0 ? job.minPay : undefined
  const salaryMax = typeof job.maxPay === "number" && job.maxPay > 0 ? job.maxPay : undefined
  const postedAt = toPostedAt(job.jobPostingStartDate)
  const employmentType = job.employmentTypes?.[0]?.trim() || undefined
  return {
    externalId: `walmart:${id}`,
    title,
    applyUrl,
    location,
    postedAt,
    employmentType,
    salaryMin,
    salaryMax,
    salaryCurrency: salaryMin || salaryMax ? "USD" : undefined,
    contentHash: hashContent([title, applyUrl, location, salaryMin, salaryMax, postedAt, employmentType]),
  }
}

export const walmartAdapter: AtsAdapter = {
  name: "walmart",
  // One Walmart harvest at a time — strictly sequential paginations.
  concurrency: envConcurrency("walmart", 1),
  detectFromUrl(url) {
    if (!WALMART_HOST_RE.test(url)) return null
    return { slug: "walmart" }
  },
  async fetchJobs({ ctx }): Promise<HarvestResult> {
    const startedAt = Date.now()
    const jobs = new Map<string, HarvestedJob>()
    let upstreamLatencyMs = 0
    let anyOk = false

    const reqCtx: HarvestCtx = {
      ...ctx,
      etag: null,
      lastModified: null,
      timeoutMs: Math.max(ctx.timeoutMs ?? 0, 20_000),
    }

    for (const area of AREAS) {
      for (let page = 0; page < MAX_PAGES_PER_AREA; page += 1) {
        if ((page > 0 || anyOk) && PAGE_DELAY_MS > 0) await sleep(PAGE_DELAY_MS)

        const res = await conditionalFetchJson<SearchResponse>(ENDPOINT, reqCtx, {
          method: "POST",
          body: buildBody(area, page),
          maxAttempts: 3,
        })
        // Persistent error/throttle (already retried w/ backoff): give up on this
        // area but keep whatever we've gathered from the others.
        if (res.kind !== "ok") break
        anyOk = true
        upstreamLatencyMs += res.upstreamLatencyMs

        const { total, jobs: batch } = artifactOf(res.data)
        if (batch.length === 0) break

        let added = 0
        for (const raw of batch) {
          const job = mapJob(raw)
          if (!job || jobs.has(job.externalId)) continue
          jobs.set(job.externalId, job)
          added += 1
        }
        // No new jobs (all dupes) or we've paged past the total → next area.
        if (added === 0) break
        if ((page + 1) * PAGE_SIZE >= total) break
      }
    }

    if (!anyOk) {
      const err = new Error("walmart fetch failed: no pages fetched")
      ;(err as Error & { status?: number | null }).status = null
      throw err
    }

    return {
      jobs: Array.from(jobs.values()),
      notModified: false,
      etag: null,
      lastModified: null,
      sourceAts: "walmart",
      sourceAtsSlug: "walmart",
      fetchedAt: new Date(),
      upstreamLatencyMs: upstreamLatencyMs || Date.now() - startedAt,
    }
  },
}
