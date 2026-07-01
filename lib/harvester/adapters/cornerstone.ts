import {
  envConcurrency,
  hashContent,
  linkAbortSignal,
  throwIfAborted,
  type AtsAdapter,
  type HarvestCtx,
  type HarvestResult,
  type HarvestedJob,
} from "@/lib/harvester/adapters/_base"
import { harvesterFetch } from "@/lib/harvester/http-agent"

/**
 * Cornerstone OnDemand (CSOD) careers.
 *
 * Career sites live at:
 *   https://{slug}.csod.com/ux/ats/careersite/{site_id}/home?c={slug}
 *
 * Two-step flow (mirrors tools/jobhive-ts/ref/cornerstone.py):
 *
 * 1. GET the career-site HTML and extract a JWT token (`csod.context.token`)
 *    plus the regional API host — one of `na.api.csod.com`,
 *    `eu-fra.api.csod.com`, `uk.api.csod.com`, … Falls back to
 *    `https://na.api.csod.com` when the host isn't embedded in the page.
 *
 * 2. POST `{api_host}/rec-job-search/external/jobs` with the JWT as a Bearer
 *    token. The response carries `totalCount` + `requisitions` per page; we
 *    paginate via `pageNumber` until we've collected everything (bounded).
 *
 * Slug encoding: `{slug}:{site_id}` (like workday `{tenant}:{wd}:{site}` and
 * oraclecloud `{pod}:{site}`) so a single stored string round-trips. Requisition
 * ids are namespaced with the tenant slug — they collide across tenants.
 *
 * Rate limit ~60 req/min → low concurrency (4) and a bounded page count (20).
 */

const PAGE_SIZE = 25
const MAX_PAGES = Math.max(
  1,
  Number.parseInt(process.env.HARVESTER_CORNERSTONE_MAX_PAGES ?? "20", 10)
)
const DEFAULT_API_HOST = "https://na.api.csod.com"
const DEFAULT_TIMEOUT_MS = 15_000
const RETRY_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504])
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"

// Matches `csod.context.token = "..."` in the career-site bootstrap, with a
// looser `"token":"..."` fallback for tenants whose bundle serializes it as JSON.
const TOKEN_RE = /csod\.context\.token\s*=\s*['"]([^'"]+)['"]/
const TOKEN_FALLBACK_RE = /"token"\s*:\s*"([^"]+)"/
const API_HOST_RE = /(https?:\/\/[a-z0-9-]+\.api\.csod\.com)/i
const TAG_RE = /<[^>]+>/g

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/i

// Cornerstone tenants who haven't filled in the public description leave the
// field as one of these placeholders. Drop them — better an empty description
// column than "Please upload" everywhere. Mirrors the py.
const PLACEHOLDER_DESCRIPTIONS = new Set([
  "please upload the job description",
  "please upload a job description",
  "please add the job description",
  "no description available",
  "to be confirmed",
  "tbc",
  "used for itt applications",
  "n/a",
  "tba",
  "see job description",
])

type CsodLocation = {
  city?: string
  state?: string
  country?: string
  name?: string
  displayName?: string
}

type CsodRequisition = {
  requisitionId?: string | number
  displayJobTitle?: string
  externalDescription?: string
  locations?: Array<CsodLocation | string>
  schedule?: string
  jobType?: string
  shift?: string
  postingEffectiveDate?: string
}

type CsodJobsData = {
  totalCount?: number
  requisitions?: CsodRequisition[]
}

type CsodJobsResponse = {
  data?: CsodJobsData
}

type ParsedSlug = {
  slug: string
  siteId: number
}

function parseSlug(raw: string): ParsedSlug | null {
  const idx = raw.lastIndexOf(":")
  if (idx <= 0) return null
  const slug = raw.slice(0, idx)
  const siteId = Number.parseInt(raw.slice(idx + 1), 10)
  if (!SLUG_RE.test(slug)) return null
  if (!Number.isFinite(siteId) || siteId < 1) return null
  return { slug, siteId }
}

function encodeSlug(slug: string, siteId: number): string {
  return `${slug}:${siteId}`
}

function careerUrl(slug: string, siteId: number): string {
  return `https://${slug}.csod.com/ux/ats/careersite/${siteId}/home?c=${slug}`
}

function detectFromUrl(url: string): { slug: string } | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  const host = parsed.hostname.toLowerCase()
  const m = host.match(/^([a-z0-9-]+)\.csod\.com$/)
  if (!m) return null
  let slug = m[1]
  if (slug === "www" || slug === "api") return null

  // Prefer the explicit `?c=` tenant param when present — it's the canonical
  // slug and sometimes differs in case from the subdomain.
  const cParam = parsed.searchParams.get("c")
  if (cParam && SLUG_RE.test(cParam)) slug = cParam

  // Path looks like /ux/ats/careersite/{site_id}/home — pull the site id.
  const siteMatch = parsed.pathname.match(/\/careersite\/(\d+)\//)
  const siteId = siteMatch ? Number.parseInt(siteMatch[1], 10) : 1
  if (!Number.isFinite(siteId) || siteId < 1) return { slug: encodeSlug(slug, 1) }

  return { slug: encodeSlug(slug, siteId) }
}

function jobUrl(slug: string, siteId: number, reqId: string): string {
  return `https://${slug}.csod.com/ux/ats/careersite/${siteId}/job/${encodeURIComponent(reqId)}?c=${slug}`
}

function stripHtml(value: string | undefined | null): string | undefined {
  if (!value) return undefined
  const cleaned = value
    .replace(TAG_RE, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim()
  if (!cleaned) return undefined
  if (PLACEHOLDER_DESCRIPTIONS.has(cleaned.toLowerCase())) return undefined
  return cleaned.slice(0, 25_000)
}

function flattenLocation(value: CsodRequisition["locations"]): string | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined
  const first = value[0]
  if (typeof first === "string") return first.trim() || undefined
  if (!first || typeof first !== "object") return undefined
  const parts = [first.city, first.state, first.country]
    .map((p) => (typeof p === "string" ? p.trim() : ""))
    .filter(Boolean)
  if (parts.length > 0) return parts.join(", ")
  const name = first.name ?? first.displayName
  return typeof name === "string" && name.trim() ? name.trim() : undefined
}

/**
 * Cornerstone ships `postingEffectiveDate` as `M/D/YYYY` (US locale) for most
 * tenants; some non-US locales use ISO. Try ISO first (cheapest), then the
 * localized formats. Drop anything unparseable so the timestamptz cast is safe.
 */
function parsePostedAt(value: string | undefined | null): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined
  const cleaned = value.trim()
  const iso = new Date(cleaned)
  if (/^\d{4}-\d{2}-\d{2}/.test(cleaned) && !Number.isNaN(iso.getTime())) {
    return iso.toISOString()
  }
  // M/D/YYYY (US). Cornerstone's default locale.
  const md = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (md) {
    const [, m, d, y] = md
    const dt = new Date(Number(y), Number(m) - 1, Number(d))
    if (!Number.isNaN(dt.getTime())) return dt.toISOString()
  }
  return undefined
}

function mapEmploymentType(value: string | undefined | null): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined
  const v = value.toLowerCase()
  if (v.includes("intern")) return "internship"
  if (v.includes("full")) return "full-time"
  if (v.includes("part")) return "part-time"
  if (v.includes("contract") || v.includes("temp") || v.includes("fixed")) return "contract"
  return value.trim()
}

export function mapRawJob(
  parsed: ParsedSlug,
  raw: CsodRequisition
): HarvestedJob | null {
  const reqId =
    typeof raw.requisitionId === "string"
      ? raw.requisitionId
      : typeof raw.requisitionId === "number"
        ? String(raw.requisitionId)
        : ""
  if (!reqId) return null
  const title = raw.displayJobTitle?.trim()
  if (!title) return null

  const applyUrl = jobUrl(parsed.slug, parsed.siteId, reqId)
  const description = stripHtml(raw.externalDescription)
  const location = flattenLocation(raw.locations)
  const postedAt = parsePostedAt(raw.postingEffectiveDate)
  const employmentType = mapEmploymentType(raw.schedule ?? raw.jobType)

  return {
    // Requisition ids collide across tenants, so namespace with the slug.
    externalId: `cornerstone:${parsed.slug}:${reqId}`,
    title,
    applyUrl,
    description,
    location,
    postedAt,
    employmentType,
    contentHash: hashContent([
      title,
      applyUrl,
      location,
      postedAt,
      employmentType,
      description?.slice(0, 4_000),
    ]),
  }
}

export function mapResponseToJobs(
  response: CsodJobsResponse,
  parsed: ParsedSlug
): HarvestedJob[] {
  const reqs = response.data?.requisitions ?? []
  const jobs: HarvestedJob[] = []
  for (const raw of reqs) {
    const mapped = mapRawJob(parsed, raw)
    if (mapped) jobs.push(mapped)
  }
  return jobs
}

/**
 * Fetch the career-site HTML and extract the JWT token + regional API host.
 * Throws on any failure — this is the first request and gates everything.
 */
export async function initSession(
  parsed: ParsedSlug,
  ctx: HarvestCtx
): Promise<{ token: string; apiHost: string; upstreamLatencyMs: number }> {
  const doFetch = ctx.fetchImpl ?? harvesterFetch
  const userAgent = ctx.userAgent ?? DEFAULT_USER_AGENT
  const timeoutMs = Math.max(1_000, ctx.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const url = careerUrl(parsed.slug, parsed.siteId)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const unlinkAbortSignal = linkAbortSignal(ctx.signal, controller)
  const startedAt = Date.now()

  try {
    throwIfAborted(ctx.signal)
    const response = await doFetch(url, {
      method: "GET",
      headers: {
        "user-agent": userAgent,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9",
        "accept-language": "en-US,en;q=0.9",
      },
      signal: controller.signal,
    })
    const upstreamLatencyMs = Date.now() - startedAt
    if (!response.ok) {
      const err = new Error(`cornerstone init returned http_${response.status} for ${url}`)
      ;(err as Error & { status?: number | null }).status = response.status
      throw err
    }
    const text = await response.text()
    const tokenMatch = TOKEN_RE.exec(text) ?? TOKEN_FALLBACK_RE.exec(text)
    if (!tokenMatch) {
      throw new Error(
        `cornerstone: couldn't extract JWT token from ${url} (page format may have changed)`
      )
    }
    const hostMatch = API_HOST_RE.exec(text)
    const apiHost = hostMatch ? hostMatch[1] : DEFAULT_API_HOST
    return { token: tokenMatch[1], apiHost, upstreamLatencyMs }
  } finally {
    clearTimeout(timer)
    unlinkAbortSignal()
  }
}

type PostResult =
  | { kind: "ok"; data: CsodJobsResponse; upstreamLatencyMs: number }
  | { kind: "error"; status: number | null; reason: string; upstreamLatencyMs: number }

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function searchPage(
  parsed: ParsedSlug,
  apiHost: string,
  token: string,
  page: number,
  ctx: HarvestCtx,
  options: { maxAttempts?: number } = {}
): Promise<PostResult> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3)
  const doFetch = ctx.fetchImpl ?? harvesterFetch
  const userAgent = ctx.userAgent ?? DEFAULT_USER_AGENT
  const timeoutMs = Math.max(1_000, ctx.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const url = `${apiHost}/rec-job-search/external/jobs`
  const origin = `https://${parsed.slug}.csod.com`
  const body = JSON.stringify({
    careerSiteId: parsed.siteId,
    careerSitePageId: parsed.siteId,
    pageNumber: page,
    pageSize: PAGE_SIZE,
    cultureId: 1,
    cultureName: "en-US",
  })

  let attempt = 0
  let lastReason = "unknown"
  let lastStatus: number | null = null
  let upstreamLatencyMs = 0

  while (attempt < maxAttempts) {
    attempt += 1
    const startedAt = Date.now()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const unlinkAbortSignal = linkAbortSignal(ctx.signal, controller)

    try {
      throwIfAborted(ctx.signal)
      const response = await doFetch(url, {
        method: "POST",
        headers: {
          "user-agent": userAgent,
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          accept: "application/json",
          origin,
          referer: `${origin}/`,
        },
        body,
        signal: controller.signal,
      })
      upstreamLatencyMs += Date.now() - startedAt

      if (response.ok) {
        const data = (await response.json()) as CsodJobsResponse
        return { kind: "ok", data, upstreamLatencyMs }
      }

      lastStatus = response.status
      lastReason = `http_${response.status}`
      if (!RETRY_STATUSES.has(response.status) || attempt >= maxAttempts) {
        return { kind: "error", status: response.status, reason: lastReason, upstreamLatencyMs }
      }
      const retryAfter = response.headers.get("retry-after")
      const retryAfterSec = retryAfter ? Number.parseFloat(retryAfter) : NaN
      const backoff = Number.isFinite(retryAfterSec)
        ? Math.min(retryAfterSec * 1000, 5_000)
        : 250 * 2 ** (attempt - 1) + Math.random() * 250
      await sleep(backoff)
    } catch (error) {
      upstreamLatencyMs += Date.now() - startedAt
      lastStatus = null
      lastReason =
        error instanceof Error && error.name === "AbortError" ? "timeout" : "fetch_error"
      if (ctx.signal?.aborted || attempt >= maxAttempts) {
        return { kind: "error", status: null, reason: lastReason, upstreamLatencyMs }
      }
      await sleep(250 * 2 ** (attempt - 1) + Math.random() * 250)
    } finally {
      clearTimeout(timer)
      unlinkAbortSignal()
    }
  }

  return { kind: "error", status: lastStatus, reason: lastReason, upstreamLatencyMs }
}

export const cornerstoneAdapter: AtsAdapter = {
  name: "cornerstone",
  // ~60 req/min rate limit; many tenants share the regional API host. Keep the
  // per-process budget low so one noisy tenant doesn't 429 the shared host.
  concurrency: envConcurrency("cornerstone", 4),
  detectFromUrl,
  async fetchJobs({ slug, ctx }): Promise<HarvestResult> {
    const fetchedAt = new Date()
    const parsed = parseSlug(slug)
    if (!parsed) throw new Error(`cornerstone: invalid slug "${slug}"`)

    // Step 1: resolve JWT token + regional API host. Throws on failure — this
    // is the first request and gates everything, like workday's first-page rule.
    const session = await initSession(parsed, ctx)
    let upstreamLatencyMs = session.upstreamLatencyMs

    const all = new Map<string, HarvestedJob>()

    // Step 2: paginate the job search. The first page's failure throws; later
    // pages break with a partial harvest so one bad page doesn't lose the rest.
    let total = Infinity
    for (let page = 1; page <= MAX_PAGES; page++) {
      const result = await searchPage(
        parsed,
        session.apiHost,
        session.token,
        page,
        ctx
      )
      upstreamLatencyMs += result.upstreamLatencyMs

      if (result.kind === "error") {
        if (page === 1) {
          const err = new Error(`cornerstone fetch failed: ${result.reason}`)
          ;(err as Error & { status?: number | null }).status = result.status
          throw err
        }
        break
      }

      const data = result.data.data ?? {}
      if (typeof data.totalCount === "number") total = data.totalCount
      const pageJobs = mapResponseToJobs(result.data, parsed)
      const reqCount = data.requisitions?.length ?? 0

      let added = 0
      for (const job of pageJobs) {
        if (all.has(job.externalId)) continue
        all.set(job.externalId, job)
        added += 1
      }

      // Stop once we've collected the reported total, or an empty page, or a
      // page that yielded nothing new (dedup guard against loops). Fall back to
      // the short-page heuristic only when the API didn't report a total —
      // Cornerstone drives pagination off `totalCount`, and a page can legally
      // come back shorter than PAGE_SIZE while more remain.
      if (reqCount === 0) break
      if (added === 0) break
      if (all.size >= total) break
      if (!Number.isFinite(total) && reqCount < PAGE_SIZE) break
    }

    return {
      jobs: Array.from(all.values()),
      notModified: false,
      // Cornerstone's job search is a JWT-gated POST; it doesn't honor
      // If-None-Match / If-Modified-Since, so we carry no validators.
      etag: null,
      lastModified: null,
      sourceAts: "cornerstone",
      sourceAtsSlug: slug,
      fetchedAt,
      upstreamLatencyMs,
    }
  },
}

export { parseSlug, encodeSlug, careerUrl, jobUrl }
