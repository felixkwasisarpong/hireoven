/**
 * Eightfold AI ("PCSX") careers adapter.
 *
 * Many companies host their careers at {tenant}.eightfold.ai.
 * The job board is a React SPA backed by a REST API at /api/pcsx/search.
 *
 * Auth flow:
 *   1. GET /careers → sets _vs session cookie; HTML contains
 *      <meta name="_csrf" content="..."> with a per-session CSRF token
 *   2. All API requests need: Cookie: _vs=... + x-csrf-token + x-browser-request-time
 *
 * Search API returns 10 results per page (page size is server-enforced, not
 * configurable via params). Pagination is offset-based via `start=0,10,20,...`.
 *
 * Optional detail enrichment: GET /api/pcsx/position_details?position_id={id}&domain={domain}
 * adds full `jobDescription` HTML.
 *
 * ats_identifier: tenant subdomain (e.g. "morganstanley" for morganstanley.eightfold.ai)
 *   The domain API param is derived as {slug}.com.
 */

import pLimit from "p-limit"
import {
  hashContent,
  envConcurrency,
  type AtsAdapter,
  type HarvestCtx,
  type HarvestResult,
  type HarvestedJob,
} from "@/lib/harvester/adapters/_base"
import { harvesterFetch } from "@/lib/harvester/http-agent"

const PAGE_SIZE = 10 // server-enforced, cannot be changed

function intEnv(name: string, dflt: number): number {
  const n = Number.parseInt(process.env[name] ?? "", 10)
  return Number.isFinite(n) && n > 0 ? n : dflt
}

const MAX_PAGES = intEnv("HARVESTER_EIGHTFOLD_MAX_PAGES", 200)
const DETAIL_MAX_JOBS = intEnv("HARVESTER_EIGHTFOLD_DETAIL_MAX_JOBS", 150)
const DETAIL_CONCURRENCY = intEnv("HARVESTER_EIGHTFOLD_DETAIL_CONCURRENCY", 4)
// apply/v2 list pages are stateless, so they're fetched concurrently.
const APPLYV2_PAGE_CONCURRENCY = intEnv("HARVESTER_EIGHTFOLD_APPLYV2_CONCURRENCY", 6)

type EightfoldPosition = {
  id?: number | string
  displayJobId?: string
  name?: string
  locations?: string[]
  standardizedLocations?: string[]
  postedTs?: number
  department?: string
  workLocationOption?: string
  positionUrl?: string
  publicUrl?: string
  /** Only the apply/v2 dialect ships the JD inline on the listing row. */
  jobDescription?: string
}

type EightfoldSearchResponse = {
  status?: number
  data?: {
    positions?: EightfoldPosition[]
    count?: number
  }
}

type EightfoldDetailResponse = {
  status?: number
  data?: EightfoldPosition & { jobDescription?: string }
}

type SessionInfo = {
  cookie: string
  csrf: string
  domain: string
  host: string
}

function slugToHost(slug: string): string {
  return `${slug}.eightfold.ai`
}

function slugToDomain(slug: string): string {
  return `${slug}.com`
}

function parseCsrfFromHtml(html: string): string | null {
  return (
    html.match(/name=["']_csrf["'][^>]*content=["']([^"']+)["']/)?.[1] ??
    html.match(/content=["']([^"']+)["'][^>]*name=["']_csrf["']/)?.[1] ??
    null
  )
}

async function establishSession(
  slug: string,
  ctx: HarvestCtx
): Promise<SessionInfo | null> {
  const host = slugToHost(slug)
  const domain = slugToDomain(slug)
  const url = `https://${host}/careers`
  const doFetch = ctx.fetchImpl ?? harvesterFetch

  let resp: Response
  try {
    resp = await doFetch(url, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml",
        "accept-language": "en-US,en;q=0.9",
      },
    })
  } catch {
    return null
  }

  if (!resp.ok) return null

  // Extract _vs session cookie from Set-Cookie header
  const setCookie = resp.headers.get("set-cookie") ?? ""
  const vsMatch = setCookie.match(/(_vs=[^;]+)/)
  if (!vsMatch) return null
  const cookie = vsMatch[1]

  const html = await resp.text()
  const csrf = parseCsrfFromHtml(html)
  if (!csrf) return null

  return { cookie, csrf, domain, host }
}

function makeHeaders(session: SessionInfo): Record<string, string> {
  return {
    "user-agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    cookie: session.cookie,
    "x-csrf-token": session.csrf,
    "x-browser-request-time": String(Date.now() / 1000),
    accept: "application/json",
    "accept-language": "en-US,en;q=0.9",
    referer: `https://${session.host}/careers`,
  }
}

async function fetchSearchPage(
  start: number,
  session: SessionInfo,
  ctx: HarvestCtx
): Promise<{ positions: EightfoldPosition[]; total: number; latencyMs: number } | null> {
  const url =
    `https://${session.host}/api/pcsx/search` +
    `?domain=${encodeURIComponent(session.domain)}&query=&location=&start=${start}&sort_by=timestamp`
  const doFetch = ctx.fetchImpl ?? harvesterFetch
  const startedAt = Date.now()
  try {
    const resp = await doFetch(url, { headers: makeHeaders(session) })
    const latencyMs = Date.now() - startedAt
    if (!resp.ok) return null
    const data: EightfoldSearchResponse = await resp.json()
    if (data.status !== 200 || !data.data) return null
    return {
      positions: data.data.positions ?? [],
      total: data.data.count ?? 0,
      latencyMs,
    }
  } catch {
    return null
  }
}

// Some Eightfold tenants (e.g. HSBC, Bayer) don't expose the session-gated
// `/api/pcsx/search` dialect (it 403s even with a valid cookie+CSRF) and instead
// serve the open `/api/apply/v2/jobs` dialect — the same one Netflix uses. This
// fetches that dialect and normalizes rows into the shared EightfoldPosition shape
// so the rest of the pipeline (mapPosition, detail enrichment) is unchanged.
type ApplyV2Position = {
  id?: number | string
  name?: string
  location?: string
  locations?: string[]
  t_update?: number
  canonicalPositionUrl?: string
  display_job_id?: string
  work_location_option?: string
  job_description?: string
}
type ApplyV2Response = { count?: number; positions?: ApplyV2Position[] }

async function fetchApplyV2Page(
  start: number,
  session: SessionInfo,
  ctx: HarvestCtx
): Promise<{ positions: EightfoldPosition[]; total: number; latencyMs: number } | null> {
  const url =
    `https://${session.host}/api/apply/v2/jobs` +
    `?domain=${encodeURIComponent(session.domain)}&num=${PAGE_SIZE}&start=${start}&sort_by=timestamp`
  const doFetch = ctx.fetchImpl ?? harvesterFetch
  const startedAt = Date.now()
  try {
    const resp = await doFetch(url, { headers: makeHeaders(session) })
    const latencyMs = Date.now() - startedAt
    if (!resp.ok) return null
    const data: ApplyV2Response = await resp.json()
    if (!Array.isArray(data.positions)) return null
    const positions: EightfoldPosition[] = data.positions.map((p) => ({
      id: p.id,
      name: p.name,
      displayJobId: p.display_job_id,
      locations:
        Array.isArray(p.locations) && p.locations.length
          ? p.locations
          : p.location
            ? [p.location]
            : [],
      postedTs: p.t_update, // unix seconds, like postedTs
      positionUrl: p.canonicalPositionUrl,
      workLocationOption: p.work_location_option,
      jobDescription: p.job_description, // inline JD — no detail round-trip needed
    }))
    return { positions, total: data.count ?? positions.length, latencyMs }
  } catch {
    return null
  }
}

async function fetchPositionDetail(
  positionId: number | string,
  session: SessionInfo,
  ctx: HarvestCtx
): Promise<{ jobDescription?: string; workLocationOption?: string } | null> {
  const url =
    `https://${session.host}/api/pcsx/position_details` +
    `?position_id=${positionId}&domain=${encodeURIComponent(session.domain)}&hl=en`
  const doFetch = ctx.fetchImpl ?? harvesterFetch
  try {
    const resp = await doFetch(url, { headers: makeHeaders(session) })
    if (!resp.ok) return null
    const data: EightfoldDetailResponse = await resp.json()
    if (data.status !== 200 || !data.data) return null
    return {
      jobDescription: data.data.jobDescription ?? undefined,
      workLocationOption: data.data.workLocationOption ?? undefined,
    }
  } catch {
    return null
  }
}

function stripHtml(html: string | undefined | null): string | undefined {
  if (!html) return undefined
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|li|br|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s{2,}/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim() || undefined
}

function mapWorkMode(opt: string | undefined | null): string | undefined {
  if (!opt) return undefined
  const v = opt.toLowerCase()
  if (v === "remote") return "remote"
  if (v === "hybrid") return "hybrid"
  return undefined
}

function mapPosition(pos: EightfoldPosition, host: string): HarvestedJob | null {
  const id = pos.id
  const title = pos.name?.trim()
  if (!id || !title) return null

  const relUrl = pos.positionUrl ?? pos.publicUrl ?? `/careers/job/${id}`
  const applyUrl = relUrl.startsWith("http")
    ? relUrl
    : `https://${host}${relUrl.startsWith("/") ? relUrl : `/${relUrl}`}`

  const location = pos.locations?.filter(Boolean).join(", ") || undefined
  const postedAt = pos.postedTs ? new Date(pos.postedTs * 1000).toISOString() : undefined
  const workMode = mapWorkMode(pos.workLocationOption)
  const description = pos.jobDescription ? stripHtml(pos.jobDescription) : undefined

  // Only fold the JD into the hash when present (apply/v2) so pcsx rows — whose
  // description arrives later via the detail pass — keep their original hash.
  const hashInputs = [title, applyUrl, location, workMode, postedAt]
  if (description) hashInputs.push(description.slice(0, 2_000))

  return {
    externalId: `eightfold:${id}`,
    title,
    applyUrl,
    location,
    postedAt,
    workMode,
    description,
    contentHash: hashContent(hashInputs),
  }
}

export const eightfoldAdapter: AtsAdapter = {
  name: "eightfold",
  concurrency: envConcurrency("eightfold", 2),

  detectFromUrl(url: string): { slug: string } | null {
    const m = url.match(/^https?:\/\/([a-z0-9-]+)\.eightfold\.ai\//i)
    if (!m) return null
    return { slug: m[1].toLowerCase() }
  },

  async fetchJobs({ slug, ctx }): Promise<HarvestResult> {
    const fetchedAt = new Date()
    const startedAt = Date.now()

    const session = await establishSession(slug, ctx)
    if (!session) {
      const err = new Error(`eightfold: failed to establish session for ${slug}`)
      ;(err as Error & { status?: number | null }).status = null
      throw err
    }

    // Page 0 to get total count. Try the pcsx/search dialect first; if the tenant
    // doesn't support it (HSBC/Bayer return 403 even with a valid session), fall
    // back to the open apply/v2 dialect and use it for every subsequent page.
    let dialect: "pcsx" | "applyv2" = "pcsx"
    let firstPage = await fetchSearchPage(0, session, ctx)
    if (!firstPage) {
      firstPage = await fetchApplyV2Page(0, session, ctx)
      if (firstPage) dialect = "applyv2"
    }
    if (!firstPage) {
      const err = new Error(`eightfold: search page 0 failed for ${slug}`)
      ;(err as Error & { status?: number | null }).status = null
      throw err
    }

    const totalPositions = firstPage.total
    const totalPages = Math.min(MAX_PAGES, Math.ceil(totalPositions / PAGE_SIZE))
    let totalLatencyMs = firstPage.latencyMs

    const seen = new Map<string, HarvestedJob>()
    for (const pos of firstPage.positions) {
      const job = mapPosition(pos, session.host)
      if (job) seen.set(job.externalId, job)
    }

    const ingest = (positions: EightfoldPosition[]) => {
      for (const pos of positions) {
        const job = mapPosition(pos, session.host)
        if (job && !seen.has(job.externalId)) seen.set(job.externalId, job)
      }
    }

    if (dialect === "applyv2") {
      // apply/v2 pages are stateless (no CSRF chain), so fetch them concurrently —
      // a large tenant like HSBC is ~160 pages and would blow the per-company
      // timeout if walked one-at-a-time.
      const pageNums = Array.from({ length: totalPages - 1 }, (_, i) => i + 1)
      const limiter = pLimit(APPLYV2_PAGE_CONCURRENCY)
      const results = await Promise.all(
        pageNums.map((page) => limiter(() => fetchApplyV2Page(page * PAGE_SIZE, session, ctx))),
      )
      for (const result of results) {
        if (!result) continue
        totalLatencyMs += result.latencyMs
        ingest(result.positions)
      }
    } else {
      // pcsx pages share session cookies + CSRF, so they must stay sequential.
      for (let page = 1; page < totalPages; page++) {
        const result = await fetchSearchPage(page * PAGE_SIZE, session, ctx)
        if (!result) break
        totalLatencyMs += result.latencyMs
        ingest(result.positions)
      }
    }

    const allJobs = Array.from(seen.values())

    // Enrich with full descriptions via the pcsx detail endpoint. Skipped for the
    // apply/v2 dialect: those rows already carry the JD inline, and pcsx detail
    // 403s on those tenants — so the pass would be ~150 wasted requests that blow
    // the per-company timeout (the original HSBC/Bayer hang).
    const needDetail =
      dialect === "applyv2"
        ? []
        : ctx.alreadyDescribedIds
          ? allJobs.filter((j) => !ctx.alreadyDescribedIds!.has(j.externalId))
          : allJobs

    if (DETAIL_MAX_JOBS > 0 && needDetail.length > 0) {
      const limiter = pLimit(DETAIL_CONCURRENCY)
      await Promise.all(
        needDetail.slice(0, DETAIL_MAX_JOBS).map((job) =>
          limiter(async () => {
            // Extract position_id from externalId: "eightfold:{id}"
            const positionId = job.externalId.replace(/^eightfold:/, "")
            const detail = await fetchPositionDetail(positionId, session, ctx)
            if (detail?.jobDescription) {
              const description = stripHtml(detail.jobDescription)
              const workMode = mapWorkMode(detail.workLocationOption) ?? job.workMode
              seen.set(job.externalId, {
                ...job,
                description,
                workMode,
                contentHash: hashContent([
                  job.title,
                  job.applyUrl,
                  job.location,
                  workMode,
                  job.postedAt,
                  description?.slice(0, 2_000),
                ]),
              })
            }
          })
        )
      )
    }

    return {
      jobs: Array.from(seen.values()),
      notModified: false,
      etag: null,
      lastModified: null,
      sourceAts: "eightfold",
      sourceAtsSlug: slug,
      fetchedAt,
      upstreamLatencyMs: Math.max(totalLatencyMs, Date.now() - startedAt),
    }
  },
}
