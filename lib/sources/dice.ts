/**
 * Dice.com job search API client.
 *
 * Uses the same public API Dice's own frontend calls, authenticated with
 * the NEXT_PUBLIC_JOB_SEARCH_API_KEY embedded in their JS bundle.
 * Override via DICE_API_KEY env var if they rotate it.
 */

import { ProxyAgent, fetch as undiciFetch } from "undici"

const DICE_SEARCH_URL = "https://job-search-api.svc.dhigroupinc.com/v1/dice/jobs/search"
const PAGE_SIZE = 100
const REQUEST_TIMEOUT_MS = 12_000
// Public key from Dice's own frontend bundle (NEXT_PUBLIC_JOB_SEARCH_API_KEY)
const DICE_API_KEY = process.env.DICE_API_KEY ?? "1xgTdC84Vj5OI6cr4BBnH9v8rEJOCgLN3gVmyObZ"

// Dice WAF-blocks datacenter IPs (the harvester box gets 403 on every call while
// the same key/headers return 200 from a residential IP). Set DICE_PROXY_URL to a
// residential/proxy egress (http://user:pass@host:port) to route Dice through it.
// Inert when unset — Dice simply stays blocked until a proxy is provided.
const DICE_PROXY_URL = process.env.DICE_PROXY_URL?.trim() || ""
const DICE_DISPATCHER = DICE_PROXY_URL ? new ProxyAgent(DICE_PROXY_URL) : undefined
const fetchDiceUpstream = undiciFetch as unknown as typeof fetch
// node/undici fetch accepts `dispatcher` at runtime though it's absent from DOM types.
function withDiceProxy(init: RequestInit): RequestInit {
  return DICE_DISPATCHER ? ({ ...init, dispatcher: DICE_DISPATCHER } as RequestInit) : init
}

// Dice rate-limits/WAF-blocks bursts from datacenter IPs (the cron fires ~20
// queries × multiple pages). Pace requests and retry 403/429/5xx with backoff so
// a transient throttle doesn't fail the whole query.
const DICE_REQUEST_DELAY_MS = Number(process.env.DICE_REQUEST_DELAY_MS ?? "700")
const DICE_MAX_RETRIES = Math.max(1, Number(process.env.DICE_MAX_RETRIES ?? "4"))
const DICE_RETRYABLE_STATUSES = new Set([403, 408, 429, 500, 502, 503, 504])

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class DiceApiError extends Error {
  readonly status: number
  readonly query: string
  readonly retryable: boolean

  constructor(status: number, query: string) {
    super(`Dice API ${status || "network"} for "${query}"`)
    this.name = "DiceApiError"
    this.status = status
    this.query = query
    this.retryable = status === 0 || DICE_RETRYABLE_STATUSES.has(status)
  }
}

export interface DiceJob {
  id: string
  title: string
  company: string
  location: string
  postedDate: string
  summary: string
  applyUrl: string
  salary?: string
  workFromHome: "TRUE" | "PARTIAL" | "FALSE"
  employmentType?: string
  easyApply: boolean
  willingToSponsor: boolean
  companyPageUrl?: string
  companyLogoUrl?: string
}

export interface DiceSearchResult {
  jobs: DiceJob[]
  totalResults: number
  page: number
  pageSize: number
}

export interface DiceSearchOptions {
  q: string
  countryCode?: string
  /** ONE_DAY_AGO | THREE_DAYS_AGO | SEVEN_DAYS_AGO | THIRTY_DAYS_AGO */
  postedDate?: string
  employmentType?: string
  workplaceType?: string
  page?: number
}

export async function searchDiceJobs(opts: DiceSearchOptions): Promise<DiceSearchResult> {
  const params = new URLSearchParams({
    q: opts.q,
    countryCode: opts.countryCode ?? "US",
    pageSize: String(PAGE_SIZE),
    page: String(opts.page ?? 1),
  })
  if (opts.postedDate) params.set("filters.postedDate", opts.postedDate)
  if (opts.employmentType) params.set("filters.employmentType", opts.employmentType)
  if (opts.workplaceType) params.set("filters.workplaceTypes", opts.workplaceType)

  const url = `${DICE_SEARCH_URL}?${params}`
  const headers = {
    Accept: "application/json",
    "x-api-key": DICE_API_KEY,
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    Referer: "https://www.dice.com/",
    Origin: "https://www.dice.com",
  }

  let lastStatus = 0
  for (let attempt = 1; attempt <= DICE_MAX_RETRIES; attempt += 1) {
    let res: Response | null = null
    try {
      res = await fetchDiceUpstream(url, withDiceProxy({ headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }))
    } catch {
      res = null // network error / timeout — treat as retryable
    }

    if (res?.ok) {
      const body = (await res.json()) as {
        data?: RawDiceJob[]
        meta?: { totalResults?: number; pageSize?: number; currentPage?: number }
      }
      const jobs = (body.data ?? []).map(mapDiceJob).filter(Boolean) as DiceJob[]
      return {
        jobs,
        totalResults: body.meta?.totalResults ?? jobs.length,
        page: body.meta?.currentPage ?? (opts.page ?? 1),
        pageSize: PAGE_SIZE,
      }
    }

    lastStatus = res?.status ?? 0
    const retryable = !res || DICE_RETRYABLE_STATUSES.has(res.status)
    if (!retryable || attempt === DICE_MAX_RETRIES) break

    // Honor Retry-After; otherwise exponential backoff with jitter (capped 20s).
    const retryAfter = Number(res?.headers.get("retry-after"))
    const backoffMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.min(retryAfter * 1000, 20_000)
      : Math.min(800 * 2 ** (attempt - 1) + Math.random() * 500, 20_000)
    await sleep(backoffMs)
  }

  throw new DiceApiError(lastStatus, opts.q)
}

export async function searchDiceAllPages(
  opts: Omit<DiceSearchOptions, "page">,
  maxJobs = 500,
): Promise<DiceJob[]> {
  const all: DiceJob[] = []
  let page = 1

  while (all.length < maxJobs) {
    if (page > 1) await sleep(DICE_REQUEST_DELAY_MS) // pace pages to stay under the WAF
    const result = await searchDiceJobs({ ...opts, page })
    all.push(...result.jobs)
    if (all.length >= result.totalResults || result.jobs.length < PAGE_SIZE) break
    page++
  }

  return all.slice(0, maxJobs)
}

// ── Raw API shape ─────────────────────────────────────────────────────────────

interface RawDiceJob {
  id?: string
  guid?: string
  title?: string
  companyName?: string
  jobLocation?: { displayName?: string }
  postedDate?: string
  summary?: string
  detailsPageUrl?: string
  redirectUrl?: string
  salary?: string | null
  workFromHomeAvailability?: string
  employmentType?: string
  easyApply?: boolean
  willingToSponsor?: boolean
  companyPageUrl?: string | null
  companyLogoUrl?: string | null
}

function mapDiceJob(raw: RawDiceJob): DiceJob | null {
  const id = raw.guid ?? raw.id
  if (!id || !raw.title || !raw.companyName) return null

  const applyUrl =
    raw.detailsPageUrl?.startsWith("http") ? raw.detailsPageUrl
    : raw.redirectUrl?.startsWith("http")  ? raw.redirectUrl
    : `https://www.dice.com/job-detail/${id}`

  const wfh = (raw.workFromHomeAvailability ?? "FALSE").toUpperCase()

  return {
    id,
    title: raw.title.trim(),
    company: raw.companyName.trim(),
    location: raw.jobLocation?.displayName?.trim() ?? "",
    postedDate: raw.postedDate ?? new Date().toISOString(),
    summary: raw.summary?.trim() ?? "",
    applyUrl,
    salary: raw.salary ?? undefined,
    workFromHome: (wfh === "TRUE" || wfh === "PARTIAL" || wfh === "FALSE") ? wfh as DiceJob["workFromHome"] : "FALSE",
    employmentType: raw.employmentType ?? undefined,
    easyApply: raw.easyApply ?? false,
    willingToSponsor: raw.willingToSponsor ?? false,
    companyPageUrl: raw.companyPageUrl ?? undefined,
    companyLogoUrl: raw.companyLogoUrl ?? undefined,
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function parseDiceSalary(salary: string | undefined): {
  min?: number
  max?: number
  currency: string
} {
  if (!salary) return { currency: "USD" }
  const currency = /£|GBP/i.test(salary) ? "GBP" : /€|EUR/i.test(salary) ? "EUR" : "USD"
  // Normalise "165,000" and "$90 - $100 per hour" etc.
  const nums = [...salary.matchAll(/[\d,]+(?:\.\d+)?/g)]
    .map((m) => Math.round(parseFloat(m[0].replace(/,/g, ""))))
    .filter((n) => n > 1000) // ignore small numbers like "90" hourly rates misread as salary
  if (nums.length === 0) return { currency }
  if (nums.length === 1) return { min: nums[0], max: nums[0], currency }
  return { min: Math.min(...nums), max: Math.max(...nums), currency }
}

export function parseDiceWorkMode(wfh: DiceJob["workFromHome"]): {
  isRemote: boolean
  isHybrid: boolean
} {
  return {
    isRemote: wfh === "TRUE",
    isHybrid: wfh === "PARTIAL",
  }
}

// ── Full description enrichment ───────────────────────────────────────────────
// The Dice search API only returns a ~500-char `summary`. The full job
// description lives on the detail page as a JSON-LD JobPosting blob. Fetch it
// on demand and strip HTML.

const DICE_DETAIL_TIMEOUT_MS = 10_000
const DICE_DETAIL_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

export type FetchDiceDescriptionOptions = {
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

/** Discriminated result so callers can react to "gone" vs transient failures. */
export type DiceDetailResult =
  | { kind: "ok"; description: string }
  /** 404 / 410 from Dice — the job has been removed and won't come back. */
  | { kind: "gone"; status: number }
  /** 200 but no JobPosting JSON-LD blob — e.g. CAPTCHA page or layout change. */
  | { kind: "no_jsonld" }
  /** Other HTTP error (5xx, 403, 429, etc.) — likely transient. */
  | { kind: "http_error"; status: number }
  /** Timeout or network error. */
  | { kind: "network_error" }

export async function fetchDiceJobDetail(
  detailsPageUrl: string,
  opts: FetchDiceDescriptionOptions = {}
): Promise<DiceDetailResult> {
  const doFetch = opts.fetchImpl ?? fetchDiceUpstream
  const timeoutMs = Math.max(1_000, opts.timeoutMs ?? DICE_DETAIL_TIMEOUT_MS)

  let response: Response
  try {
    response = await doFetch(detailsPageUrl, withDiceProxy({
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": DICE_DETAIL_UA,
        Referer: "https://www.dice.com/",
      },
      signal: AbortSignal.timeout(timeoutMs),
    }))
  } catch {
    return { kind: "network_error" }
  }
  if (response.status === 404 || response.status === 410) {
    return { kind: "gone", status: response.status }
  }
  if (!response.ok) {
    return { kind: "http_error", status: response.status }
  }
  const html = await response.text()
  const description = extractJobPostingDescription(html)
  return description ? { kind: "ok", description } : { kind: "no_jsonld" }
}

/** Backwards-compat wrapper — returns just the description text or null. */
export async function fetchDiceJobDescription(
  detailsPageUrl: string,
  opts: FetchDiceDescriptionOptions = {}
): Promise<string | null> {
  const result = await fetchDiceJobDetail(detailsPageUrl, opts)
  return result.kind === "ok" ? result.description : null
}

const JSON_LD_RE =
  /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi

function extractJobPostingDescription(html: string): string | null {
  let m: RegExpExecArray | null
  // Reset state for the global regex on every call.
  JSON_LD_RE.lastIndex = 0
  while ((m = JSON_LD_RE.exec(html)) !== null) {
    let parsed: unknown
    try {
      parsed = JSON.parse(m[1].trim())
    } catch {
      continue
    }
    const nodes = Array.isArray(parsed) ? parsed : [parsed]
    for (const node of nodes) {
      if (!node || typeof node !== "object") continue
      const obj = node as Record<string, unknown>
      if (obj["@type"] !== "JobPosting") continue
      const desc = typeof obj.description === "string" ? obj.description : null
      if (!desc) continue
      const text = stripHtmlEntities(desc)
      if (text && text.length > 0) return text
    }
  }
  return null
}

function stripHtmlEntities(value: string): string {
  return value
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
}
