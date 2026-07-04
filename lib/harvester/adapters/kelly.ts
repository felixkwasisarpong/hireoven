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
 * Kelly Services (mykelly.com) HTTP adapter.
 *
 * mykelly.com is a WordPress site whose job search is powered by FacetWP. It
 * exposes the same JSON endpoint the site itself calls:
 *   POST https://www.mykelly.com/wp-json/facetwp/v1/refresh
 *   { action:"facetwp_refresh", data:{ facets:{_country:["united-states"]},
 *     template:"jobs", paged:N, … } }
 *   → { settings:{ pager:{ total_pages, total_rows } }, template:"<html>" }
 *
 * The template HTML embeds one `<data …>` element per job whose attribute holds
 * URL-encoded JSON with ~60 fields. We decode those directly (lenient — some
 * values contain stray `%`). ~2.6k US jobs, 10/page. Verified live, no auth.
 *
 * Tunables:
 *   HARVESTER_KELLY_COUNTRY       (default "united-states")
 *   HARVESTER_KELLY_MAX_PAGES     (default 320 → 3200 jobs)
 *   HARVESTER_KELLY_PAGE_DELAY_MS (default 120)
 */

const KELLY_HOST_RE = /^https?:\/\/(?:www\.)?mykelly\.com\//i
const ENDPOINT = "https://www.mykelly.com/wp-json/facetwp/v1/refresh"

function intEnv(name: string, dflt: number, min = 0): number {
  const n = Number.parseInt(process.env[name] ?? "", 10)
  return Number.isFinite(n) && n >= min ? n : dflt
}
const COUNTRY = process.env.HARVESTER_KELLY_COUNTRY?.trim() || "united-states"
const MAX_PAGES = intEnv("HARVESTER_KELLY_MAX_PAGES", 320, 1)
const PAGE_DELAY_MS = intEnv("HARVESTER_KELLY_PAGE_DELAY_MS", 120, 0)
const DATA_TAG_RE = /<data\s+([^>]+)>/g
const ENCODED_JSON_RE = /(%7B.*?%7D)/i

type FacetWpResponse = {
  settings?: { pager?: { total_pages?: number; total_rows?: number } }
  template?: string
}
type KellyJob = Record<string, unknown>

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Lenient URL-decode (site values sometimes contain stray %, which the strict
// decodeURIComponent rejects) with `+` → space, mirroring PHP's urldecode.
function safeDecode(v: unknown): string {
  const s = String(v).replace(/\+/g, " ")
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

function buildBody(paged: number): string {
  return JSON.stringify({
    action: "facetwp_refresh",
    data: {
      facets: { _country: [COUNTRY] },
      frozen_facets: {},
      http_params: { get: { _country: COUNTRY }, uri: "job-search", url_vars: {} },
      template: "jobs",
      extras: { sort: "default" },
      soft_refresh: 0,
      is_bfcache: 1,
      first_load: 0,
      paged,
    },
  })
}

// Extract each job's flattened field map from the FacetWP template HTML.
export function parseJobs(templateHtml: string): KellyJob[] {
  const out: KellyJob[] = []
  for (const m of templateHtml.matchAll(DATA_TAG_RE)) {
    const enc = m[1].match(ENCODED_JSON_RE)?.[1]
    if (!enc) continue
    let obj: Record<string, unknown>
    try {
      obj = JSON.parse(decodeURIComponent(enc))
    } catch {
      try {
        obj = JSON.parse(safeDecode(enc))
      } catch {
        continue
      }
    }
    // FacetWP stores each value as a single-item array; flatten + decode.
    const flat: KellyJob = {}
    for (const [k, v] of Object.entries(obj)) {
      flat[k] = Array.isArray(v) ? (v.length ? safeDecode(v[0]) : "") : typeof v === "string" ? safeDecode(v) : v
    }
    out.push(flat)
  }
  return out
}

function str(job: KellyJob, key: string): string {
  const v = job[key]
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim()
}

function stripHtml(s: string): string | undefined {
  const out = s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim()
  return out || undefined
}

function toIso(v: string): string | undefined {
  if (!v) return undefined
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}

export function mapJob(job: KellyJob): HarvestedJob | null {
  const id = str(job, "job_id")
  const title = str(job, "job_title")
  if (!id || !title) return null
  const wpHref = str(job, "wp-href")
  const location =
    str(job, "_job_location") ||
    [str(job, "geolocation_city"), str(job, "geolocation_state")].filter(Boolean).join(", ") ||
    undefined
  const slug = `${title} ${location ?? ""}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  const applyUrl = /^https?:\/\//i.test(wpHref)
    ? wpHref
    : `https://www.mykelly.com/job/${encodeURIComponent(id)}-${slug}/`
  const description = stripHtml(str(job, "description"))
  const employmentType = str(job, "employment_type") || str(job, "job_type") || undefined
  const workMode = /^(1|yes|true|remote)$/i.test(str(job, "remote_yesno")) ? "Remote" : undefined
  return {
    externalId: `kelly:${id}`,
    title,
    applyUrl,
    location,
    description,
    postedAt: toIso(str(job, "published_date")),
    employmentType,
    workMode,
    contentHash: hashContent([title, applyUrl, location, employmentType, workMode, description?.slice(0, 4_000)]),
  }
}

export const kellyAdapter: AtsAdapter = {
  name: "kelly",
  concurrency: envConcurrency("kelly", 1),
  detectFromUrl(url) {
    if (!KELLY_HOST_RE.test(url)) return null
    return { slug: "kelly" }
  },
  async fetchJobs({ ctx }): Promise<HarvestResult> {
    const startedAt = Date.now()
    const jobs = new Map<string, HarvestedJob>()
    let upstreamLatencyMs = 0
    let anyOk = false
    let totalPages = MAX_PAGES

    const reqCtx: HarvestCtx = {
      ...ctx,
      etag: null,
      lastModified: null,
      timeoutMs: Math.max(ctx.timeoutMs ?? 0, 20_000),
    }

    for (let page = 1; page <= Math.min(totalPages, MAX_PAGES); page += 1) {
      if (page > 1 && PAGE_DELAY_MS > 0) await sleep(PAGE_DELAY_MS)
      const res = await conditionalFetchJson<FacetWpResponse>(ENDPOINT, reqCtx, {
        method: "POST",
        body: buildBody(page),
        maxAttempts: 3,
      })
      if (res.kind !== "ok") {
        if (page === 1) {
          const err = new Error(`kelly fetch failed: ${res.kind === "error" ? res.reason : res.kind}`)
          ;(err as Error & { status?: number | null }).status = res.kind === "error" ? res.status : null
          throw err
        }
        break
      }
      anyOk = true
      upstreamLatencyMs += res.upstreamLatencyMs
      if (page === 1) {
        const pages = res.data.settings?.pager?.total_pages
        if (typeof pages === "number" && pages > 0) totalPages = pages
      }

      const batch = parseJobs(res.data.template ?? "")
      if (batch.length === 0) break
      let added = 0
      for (const raw of batch) {
        const job = mapJob(raw)
        if (!job || jobs.has(job.externalId)) continue
        jobs.set(job.externalId, job)
        added += 1
      }
      if (added === 0) break
    }

    if (!anyOk) {
      const err = new Error("kelly fetch failed: no pages fetched")
      ;(err as Error & { status?: number | null }).status = null
      throw err
    }

    return {
      jobs: Array.from(jobs.values()),
      notModified: false,
      etag: null,
      lastModified: null,
      sourceAts: "kelly",
      sourceAtsSlug: "kelly",
      fetchedAt: new Date(),
      upstreamLatencyMs: upstreamLatencyMs || Date.now() - startedAt,
    }
  },
}
