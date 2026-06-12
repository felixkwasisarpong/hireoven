/**
 * Amazon (amazon.jobs) HTTP adapter.
 *
 * Amazon runs its own careers platform with a public, stable JSON search API
 * (`/en/search.json`) — no browser needed (unlike the apple SPA). We paginate it
 * (result_limit=100, offset-based, sort=recent) and map each hit to a
 * HarvestedJob, including the full JD assembled from description + basic /
 * preferred qualifications.
 *
 * Rate limits: amazon.jobs publishes no rate-limit headers, so we stay
 * deliberately gentle — strictly sequential pages (adapter concurrency 1, no
 * parallel page fetches), a configurable inter-page delay, and conditionalFetchJson's
 * built-in 429/5xx retry+backoff (honors Retry-After). Tunables:
 *   HARVESTER_AMAZON_MAX_PAGES        (default 100; API caps total at 10k)
 *   HARVESTER_AMAZON_PAGE_DELAY_MS    (default 300)
 *   HARVESTER_AMAZON_COUNTRIES        (default "USA,CAN"; "" = keep all)
 * NOTE: amazon.jobs ignores its own country[] query param (verified — returns
 * a global mix regardless), so we filter on each job's country_code instead.
 * The whole run is gated by the amazon per-company timeout (worker.ts: 150s).
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

const AMAZON_HOST_RE = /^https?:\/\/(www\.)?amazon\.jobs\//i
const BASE = "https://www.amazon.jobs"
const PAGE_SIZE = 100
const MAX_OFFSET = 9_900 // amazon.jobs caps the total result set at 10k

function intEnv(name: string, dflt: number, min = 0): number {
  const n = Number.parseInt(process.env[name] ?? "", 10)
  return Number.isFinite(n) && n >= min ? n : dflt
}
const MAX_PAGES = Math.min(100, intEnv("HARVESTER_AMAZON_MAX_PAGES", 100, 1))
const PAGE_DELAY_MS = intEnv("HARVESTER_AMAZON_PAGE_DELAY_MS", 300, 0)
// amazon.jobs uses 3-letter country codes (USA, CAN, AUS, ...). Empty = keep all.
const COUNTRIES = new Set(
  (process.env.HARVESTER_AMAZON_COUNTRIES ?? "USA,CAN")
    .split(",")
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean)
)

type AmazonJob = {
  id?: number | string
  id_icims?: string
  title?: string
  job_path?: string
  city?: string
  state?: string
  location?: string
  normalized_location?: string
  country_code?: string
  posted_date?: string
  description?: string
  basic_qualifications?: string
  preferred_qualifications?: string
  job_schedule_type?: string
}
type SearchResponse = { hits?: number; jobs?: AmazonJob[] | null }

function stripHtml(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function parsePosted(value: string | undefined): string | undefined {
  if (!value) return undefined
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined
}

function mapEmployment(value: string | undefined): string | undefined {
  const v = (value ?? "").toLowerCase()
  if (v.includes("full")) return "fulltime"
  if (v.includes("part")) return "parttime"
  if (v.includes("intern")) return "internship"
  return undefined
}

function assembleDescription(job: AmazonJob): string | undefined {
  const parts = [
    stripHtml(job.description),
    job.basic_qualifications ? `Basic qualifications:\n${stripHtml(job.basic_qualifications)}` : "",
    job.preferred_qualifications ? `Preferred qualifications:\n${stripHtml(job.preferred_qualifications)}` : "",
  ].filter(Boolean)
  const joined = parts.join("\n\n").slice(0, 12_000)
  return joined || undefined
}

function buildUrl(offset: number): string {
  // No country param — amazon.jobs ignores it; we filter on country_code below.
  const params = new URLSearchParams({ result_limit: String(PAGE_SIZE), offset: String(offset), sort: "recent" })
  return `${BASE}/en/search.json?${params.toString()}`
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export const amazonAdapter: AtsAdapter = {
  name: "amazon",
  // One Amazon harvest at a time — never run parallel paginations.
  concurrency: envConcurrency("amazon", 1),
  detectFromUrl(url) {
    if (!AMAZON_HOST_RE.test(url)) return null
    return { slug: "amazon" }
  },
  async fetchJobs({ ctx }): Promise<HarvestResult> {
    const startedAt = Date.now()
    const seen = new Set<string>()
    const jobs: HarvestedJob[] = []
    // amazon.jobs ignores conditional headers; bound per-request time.
    const reqCtx: HarvestCtx = {
      ...ctx,
      etag: null,
      lastModified: null,
      timeoutMs: Math.max(ctx.timeoutMs ?? 0, 15_000),
    }
    let upstreamLatencyMs = 0

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const offset = page * PAGE_SIZE
      if (offset > MAX_OFFSET) break
      if (page > 0 && PAGE_DELAY_MS > 0) await sleep(PAGE_DELAY_MS) // pace requests

      const res = await conditionalFetchJson<SearchResponse>(buildUrl(offset), reqCtx, { maxAttempts: 3 })
      if (res.kind !== "ok") break // persistent error/throttle (already retried w/ backoff) — stop cleanly
      upstreamLatencyMs += res.upstreamLatencyMs

      const batch = res.data.jobs ?? []
      if (batch.length === 0) break

      for (const job of batch) {
        const id = String(job.id ?? job.id_icims ?? "").trim()
        const title = (job.title ?? "").trim()
        if (!id || !title || !job.job_path || seen.has(id)) continue
        if (COUNTRIES.size > 0 && !COUNTRIES.has((job.country_code ?? "").toUpperCase())) continue
        seen.add(id)
        const location =
          job.normalized_location?.trim() ||
          [job.city, job.state].filter(Boolean).join(", ") ||
          job.location?.trim() ||
          undefined
        const description = assembleDescription(job)
        jobs.push({
          externalId: id,
          title,
          applyUrl: `${BASE}${job.job_path}`,
          location,
          description,
          postedAt: parsePosted(job.posted_date),
          employmentType: mapEmployment(job.job_schedule_type),
          contentHash: hashContent([title, `${BASE}${job.job_path}`, location, (description ?? "").slice(0, 4_000)]),
        })
      }

      if (batch.length < PAGE_SIZE) break // last page
    }

    return {
      jobs,
      notModified: false,
      etag: null,
      lastModified: null,
      sourceAts: "amazon",
      sourceAtsSlug: "amazon",
      fetchedAt: new Date(),
      upstreamLatencyMs: upstreamLatencyMs || Date.now() - startedAt,
    }
  },
}
