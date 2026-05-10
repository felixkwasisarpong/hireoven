/**
 * Dice.com job search API client.
 *
 * Uses the same public API Dice's own frontend calls, authenticated with
 * the NEXT_PUBLIC_JOB_SEARCH_API_KEY embedded in their JS bundle.
 * Override via DICE_API_KEY env var if they rotate it.
 */

const DICE_SEARCH_URL = "https://job-search-api.svc.dhigroupinc.com/v1/dice/jobs/search"
const PAGE_SIZE = 100
const REQUEST_TIMEOUT_MS = 12_000
// Public key from Dice's own frontend bundle (NEXT_PUBLIC_JOB_SEARCH_API_KEY)
const DICE_API_KEY = process.env.DICE_API_KEY ?? "1xgTdC84Vj5OI6cr4BBnH9v8rEJOCgLN3gVmyObZ"

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

  const res = await fetch(`${DICE_SEARCH_URL}?${params}`, {
    headers: {
      Accept: "application/json",
      "x-api-key": DICE_API_KEY,
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Referer: "https://www.dice.com/",
      Origin: "https://www.dice.com",
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })

  if (!res.ok) throw new Error(`Dice API ${res.status} for "${opts.q}"`)

  const body = await res.json() as {
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

export async function searchDiceAllPages(
  opts: Omit<DiceSearchOptions, "page">,
  maxJobs = 500,
): Promise<DiceJob[]> {
  const all: DiceJob[] = []
  let page = 1

  while (all.length < maxJobs) {
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
