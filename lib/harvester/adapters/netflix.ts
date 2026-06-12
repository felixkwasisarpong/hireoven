/**
 * Netflix (explore.jobs.netflix.net) HTTP adapter.
 *
 * Netflix runs on Eightfold, which exposes a public JSON API:
 *   list:   /api/apply/v2/jobs?domain=netflix.com&start=N&num=10
 *           -> { count, positions: [{ id, name, location, locations, t_update,
 *                canonicalPositionUrl, job_description(EMPTY in list) }] }
 *   detail: /api/apply/v2/jobs/{id}?domain=netflix.com  -> { job_description }
 *
 * The list omits the JD, so we paginate it then fetch descriptions for a
 * bounded budget per tick (skip ctx.alreadyDescribedIds) — the detail-budget
 * pattern. (Eightfold powers many careers sites; this is structured to
 * generalize to an `eightfold` adapter later if more tenants are added.)
 *
 * Rate limits: no rate-limit headers — sequential pages, configurable delays,
 * conditionalFetchJson 429/Retry-After backoff, capped detail budget, tier_2.
 *   HARVESTER_NETFLIX_MAX_PAGES         (default 80; 10/page)
 *   HARVESTER_NETFLIX_PAGE_DELAY_MS     (default 150)
 *   HARVESTER_NETFLIX_DETAIL_MAX_JOBS   (default 60)
 *   HARVESTER_NETFLIX_DETAIL_DELAY_MS   (default 150)
 *   HARVESTER_NETFLIX_COUNTRIES         (default "USA,United States,Canada"; "" = all)
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

const HOST_RE = /^https?:\/\/explore\.jobs\.netflix\.net\//i
const LIST_URL = "https://explore.jobs.netflix.net/api/apply/v2/jobs?domain=netflix.com&num=10&start="
const DETAIL_URL = "https://explore.jobs.netflix.net/api/apply/v2/jobs/"
const PAGE_SIZE = 10

function intEnv(name: string, dflt: number, min = 0): number {
  const n = Number.parseInt(process.env[name] ?? "", 10)
  return Number.isFinite(n) && n >= min ? n : dflt
}
const MAX_PAGES = intEnv("HARVESTER_NETFLIX_MAX_PAGES", 80, 1)
const PAGE_DELAY_MS = intEnv("HARVESTER_NETFLIX_PAGE_DELAY_MS", 150, 0)
const DETAIL_MAX_JOBS = intEnv("HARVESTER_NETFLIX_DETAIL_MAX_JOBS", 60, 0)
const DETAIL_DELAY_MS = intEnv("HARVESTER_NETFLIX_DETAIL_DELAY_MS", 150, 0)
const COUNTRY_MARKERS = (process.env.HARVESTER_NETFLIX_COUNTRIES ?? "USA,United States,Canada")
  .split(",")
  .map((c) => c.trim().toLowerCase())
  .filter(Boolean)

type Position = {
  id?: number | string
  name?: string
  location?: string
  locations?: string[]
  t_update?: number | string
  canonicalPositionUrl?: string
  job_description?: string | null
}
type ListResponse = { count?: number; positions?: Position[] | null }

function stripHtml(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])\s*>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&rsquo;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 12_000)
}

function inAllowedCountry(loc: string | undefined, locs: string[] | undefined): boolean {
  if (COUNTRY_MARKERS.length === 0) return true
  const hay = [loc ?? "", ...(locs ?? [])].join(" | ").toLowerCase()
  return COUNTRY_MARKERS.some((m) => hay.includes(m))
}

function parsePosted(ts: number | string | undefined): string | undefined {
  const n = typeof ts === "string" ? Number.parseInt(ts, 10) : ts
  if (!n || !Number.isFinite(n)) return undefined
  return new Date(n * 1000).toISOString()
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export const netflixAdapter: AtsAdapter = {
  name: "netflix",
  concurrency: envConcurrency("netflix", 1),
  detectFromUrl(url) {
    if (!HOST_RE.test(url)) return null
    return { slug: "netflix" }
  },
  async fetchJobs({ ctx }): Promise<HarvestResult> {
    const startedAt = Date.now()
    const reqCtx: HarvestCtx = { ...ctx, etag: null, lastModified: null, timeoutMs: Math.max(ctx.timeoutMs ?? 0, 12_000) }
    const seen = new Set<string>()
    const jobs: HarvestedJob[] = []
    let upstreamLatencyMs = 0

    // ── Phase 1: paginate the list ──
    for (let page = 0; page < MAX_PAGES; page += 1) {
      if (page > 0 && PAGE_DELAY_MS > 0) await sleep(PAGE_DELAY_MS)
      const res = await conditionalFetchJson<ListResponse>(`${LIST_URL}${page * PAGE_SIZE}`, reqCtx, { maxAttempts: 3 })
      if (res.kind !== "ok") break
      upstreamLatencyMs += res.upstreamLatencyMs
      const positions = res.data.positions ?? []
      if (positions.length === 0) break

      for (const p of positions) {
        const id = String(p.id ?? "").trim()
        const title = (p.name ?? "").trim()
        if (!id || !title || seen.has(id)) continue
        if (!inAllowedCountry(p.location, p.locations)) continue
        seen.add(id)
        const applyUrl = p.canonicalPositionUrl?.trim() || `https://explore.jobs.netflix.net/careers/job/${id}`
        const location = p.location?.trim() || p.locations?.[0]?.trim() || undefined
        jobs.push({
          externalId: id,
          title,
          applyUrl,
          location,
          postedAt: parsePosted(p.t_update),
          contentHash: hashContent([title, applyUrl, location]),
        })
      }

      if (positions.length < PAGE_SIZE) break
    }

    // ── Phase 2: detail-fetch JDs for a bounded budget ──
    if (DETAIL_MAX_JOBS > 0) {
      const targets = jobs
        .filter((j) => !ctx.alreadyDescribedIds?.has(j.externalId))
        .slice(0, DETAIL_MAX_JOBS)
      for (let i = 0; i < targets.length; i += 1) {
        if (DETAIL_DELAY_MS > 0) await sleep(DETAIL_DELAY_MS)
        const job = targets[i]
        const res = await conditionalFetchJson<Position>(
          `${DETAIL_URL}${job.externalId}?domain=netflix.com`,
          reqCtx,
          { maxAttempts: 2 }
        )
        if (res.kind !== "ok") continue
        upstreamLatencyMs += res.upstreamLatencyMs
        const description = stripHtml(res.data.job_description)
        if (description.length < 200) continue
        job.description = description
        job.contentHash = hashContent([job.title, job.applyUrl, job.location, description.slice(0, 4_000)])
      }
    }

    return {
      jobs,
      notModified: false,
      etag: null,
      lastModified: null,
      sourceAts: "netflix",
      sourceAtsSlug: "netflix",
      fetchedAt: new Date(),
      upstreamLatencyMs: upstreamLatencyMs || Date.now() - startedAt,
    }
  },
}
