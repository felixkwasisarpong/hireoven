/**
 * Microsoft (jobs.careers.microsoft.com) HTTP adapter.
 *
 * Microsoft runs on a Phenom "pcsx" careers platform with a public JSON API:
 *   search:  https://apply.careers.microsoft.com/api/pcsx/search?domain=microsoft.com&start=N
 *            -> data.positions[] (id, displayJobId, name, locations,
 *               standardizedLocations, postedTs) — NO job description
 *   detail:  https://apply.careers.microsoft.com/api/pcsx/position_details?position_id={id}&domain=microsoft.com
 *            -> data.jobDescription (full HTML JD)
 *
 * Search is fixed at 10 results/page, and the JD only comes from the detail
 * endpoint — so we paginate the (light) search to build the listing, then
 * fetch descriptions for a bounded budget of jobs per tick, skipping ones we
 * already described (ctx.alreadyDescribedIds). New jobs gain their JD over a
 * tick or two.
 *
 * Rate limits: no rate-limit headers, so we stay gentle — sequential pages,
 * configurable inter-request delays, conditionalFetchJson 429/Retry-After
 * backoff, a capped detail budget, and tier_2 (hourly) scheduling.
 *   HARVESTER_MICROSOFT_MAX_PAGES         (default 200; 10/page)
 *   HARVESTER_MICROSOFT_PAGE_DELAY_MS     (default 150)
 *   HARVESTER_MICROSOFT_DETAIL_MAX_JOBS   (default 60)
 *   HARVESTER_MICROSOFT_DETAIL_DELAY_MS   (default 150)
 *   HARVESTER_MICROSOFT_COUNTRIES         (default "US,CA"; "" = keep all)
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

const HOST_RE = /^https?:\/\/(jobs|apply|www)?\.?careers\.microsoft\.com\//i
const SEARCH_URL = "https://apply.careers.microsoft.com/api/pcsx/search?domain=microsoft.com&query=&location=&start="
const DETAIL_URL = "https://apply.careers.microsoft.com/api/pcsx/position_details?domain=microsoft.com&hl=en&position_id="
const PUBLIC_JOB_BASE = "https://jobs.careers.microsoft.com/global/en/job/"
const PAGE_SIZE = 10 // pcsx is fixed at 10/page

function intEnv(name: string, dflt: number, min = 0): number {
  const n = Number.parseInt(process.env[name] ?? "", 10)
  return Number.isFinite(n) && n >= min ? n : dflt
}
const MAX_PAGES = intEnv("HARVESTER_MICROSOFT_MAX_PAGES", 200, 1)
const PAGE_DELAY_MS = intEnv("HARVESTER_MICROSOFT_PAGE_DELAY_MS", 150, 0)
const DETAIL_MAX_JOBS = intEnv("HARVESTER_MICROSOFT_DETAIL_MAX_JOBS", 60, 0)
const DETAIL_DELAY_MS = intEnv("HARVESTER_MICROSOFT_DETAIL_DELAY_MS", 150, 0)
const COUNTRIES = new Set(
  (process.env.HARVESTER_MICROSOFT_COUNTRIES ?? "US,CA")
    .split(",")
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean)
)

type Position = {
  id?: number | string
  displayJobId?: string
  name?: string
  locations?: string[]
  standardizedLocations?: string[]
  postedTs?: number | string
}
type SearchResponse = { data?: { count?: number; positions?: Position[] | null } }
type DetailResponse = { data?: { jobDescription?: string | null } }

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

/** Country code from a standardizedLocations entry: "US" | "Taipei City,TW" | "Beijing, Beijing, CN". */
function countryOf(std: string): string {
  const parts = std.split(",")
  return (parts[parts.length - 1] ?? "").trim().toUpperCase()
}

function inAllowedCountry(stds: string[] | undefined): boolean {
  if (COUNTRIES.size === 0) return true
  if (!stds?.length) return false
  return stds.some((s) => COUNTRIES.has(countryOf(s)))
}

function parsePosted(ts: number | string | undefined): string | undefined {
  const n = typeof ts === "string" ? Number.parseInt(ts, 10) : ts
  if (!n || !Number.isFinite(n)) return undefined
  return new Date(n * 1000).toISOString()
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export const microsoftAdapter: AtsAdapter = {
  name: "microsoft",
  concurrency: envConcurrency("microsoft", 1),
  detectFromUrl(url) {
    if (!HOST_RE.test(url)) return null
    return { slug: "microsoft" }
  },
  async fetchJobs({ ctx }): Promise<HarvestResult> {
    const startedAt = Date.now()
    const reqCtx: HarvestCtx = { ...ctx, etag: null, lastModified: null, timeoutMs: Math.max(ctx.timeoutMs ?? 0, 12_000) }
    const seen = new Set<string>()
    const jobs: HarvestedJob[] = []
    const internalIdByExternal = new Map<string, string>()
    let upstreamLatencyMs = 0

    // ── Phase 1: paginate the light search listing ──
    for (let page = 0; page < MAX_PAGES; page += 1) {
      if (page > 0 && PAGE_DELAY_MS > 0) await sleep(PAGE_DELAY_MS)
      const res = await conditionalFetchJson<SearchResponse>(`${SEARCH_URL}${page * PAGE_SIZE}`, reqCtx, { maxAttempts: 3 })
      if (res.kind !== "ok") break
      upstreamLatencyMs += res.upstreamLatencyMs
      const positions = res.data.data?.positions ?? []
      if (positions.length === 0) break

      for (const p of positions) {
        const externalId = String(p.displayJobId ?? p.id ?? "").trim()
        const internalId = String(p.id ?? "").trim()
        const title = (p.name ?? "").trim()
        if (!externalId || !internalId || !title || seen.has(externalId)) continue
        if (!inAllowedCountry(p.standardizedLocations)) continue
        seen.add(externalId)
        internalIdByExternal.set(externalId, internalId)
        const location = p.locations?.[0]?.trim() || p.standardizedLocations?.[0]?.trim() || undefined
        const applyUrl = `${PUBLIC_JOB_BASE}${externalId}`
        jobs.push({
          externalId,
          title,
          applyUrl,
          location,
          postedAt: parsePosted(p.postedTs),
          contentHash: hashContent([title, applyUrl, location]),
        })
      }

      if (positions.length < PAGE_SIZE) break // last page
    }

    // ── Phase 2: fetch JDs for a bounded budget of jobs still needing one ──
    if (DETAIL_MAX_JOBS > 0) {
      const targets = jobs
        .filter((j) => !ctx.alreadyDescribedIds?.has(j.externalId))
        .slice(0, DETAIL_MAX_JOBS)
      for (let i = 0; i < targets.length; i += 1) {
        if (DETAIL_DELAY_MS > 0) await sleep(DETAIL_DELAY_MS)
        const job = targets[i]
        const internalId = internalIdByExternal.get(job.externalId)
        if (!internalId) continue
        const res = await conditionalFetchJson<DetailResponse>(`${DETAIL_URL}${internalId}`, reqCtx, { maxAttempts: 2 })
        if (res.kind !== "ok") continue
        upstreamLatencyMs += res.upstreamLatencyMs
        const description = stripHtml(res.data.data?.jobDescription)
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
      sourceAts: "microsoft",
      sourceAtsSlug: "microsoft",
      fetchedAt: new Date(),
      upstreamLatencyMs: upstreamLatencyMs || Date.now() - startedAt,
    }
  },
}
