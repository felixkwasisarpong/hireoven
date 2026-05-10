/**
 * Dice.com job search API client.
 *
 * Dice exposes a public JSON search API used by their own frontend.
 * We search it with a set of configurable queries and map results
 * into the same RawJob shape the crawler uses.
 */

const DICE_SEARCH_URL = "https://job-search-api.svc.dhigroupinc.com/v1/dice/jobs/search"
const PAGE_SIZE = 100
const REQUEST_TIMEOUT_MS = 12_000

export interface DiceJob {
  id: string
  title: string
  company: string
  location: string
  postedDate: string          // ISO string
  description: string
  applyUrl: string
  salary?: string
  workplaceTypes?: string[]   // e.g. ["Remote", "Hybrid"]
  employmentType?: string[]   // e.g. ["FULLTIME"]
  skills?: string[]
  companyPageUrl?: string
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

  const res = await fetch(url, {
    headers: {
      Accept: "application/json, text/plain, */*",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Referer: "https://www.dice.com/",
      Origin: "https://www.dice.com",
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })

  if (!res.ok) {
    throw new Error(`Dice API responded ${res.status} for query "${opts.q}"`)
  }

  const body = await res.json() as {
    data?: RawDiceJob[]
    meta?: { totalResults?: number; pageSize?: number; page?: number }
  }

  const jobs = (body.data ?? []).map(mapDiceJob).filter(Boolean) as DiceJob[]
  return {
    jobs,
    totalResults: body.meta?.totalResults ?? jobs.length,
    page: body.meta?.page ?? (opts.page ?? 1),
    pageSize: body.meta?.pageSize ?? PAGE_SIZE,
  }
}

/**
 * Search multiple pages of Dice results for a single query, up to maxJobs.
 */
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
  title?: string
  company?: string
  location?: string
  postedDate?: string
  description?: string
  applyUrl?: string | null
  salary?: string | null
  workplaceTypes?: string[]
  employmentType?: string[]
  skills?: string[]
  companyPageUrl?: string | null
}

function mapDiceJob(raw: RawDiceJob): DiceJob | null {
  if (!raw.id || !raw.title || !raw.company) return null
  return {
    id: raw.id,
    title: raw.title.trim(),
    company: raw.company.trim(),
    location: raw.location?.trim() ?? "",
    postedDate: raw.postedDate ?? new Date().toISOString(),
    description: raw.description?.trim() ?? "",
    applyUrl: raw.applyUrl ?? `https://www.dice.com/job-detail/${raw.id}`,
    salary: raw.salary ?? undefined,
    workplaceTypes: raw.workplaceTypes,
    employmentType: raw.employmentType,
    skills: raw.skills,
    companyPageUrl: raw.companyPageUrl ?? undefined,
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
  const nums = [...salary.matchAll(/[\d,]+(?:\.\d+)?/g)]
    .map((m) => Math.round(parseFloat(m[0].replace(/,/g, ""))))
    .filter((n) => n > 0)
  if (nums.length === 0) return { currency }
  if (nums.length === 1) return { min: nums[0], max: nums[0], currency }
  return { min: Math.min(...nums), max: Math.max(...nums), currency }
}

export function parseDiceWorkMode(types: string[] | undefined): {
  isRemote: boolean
  isHybrid: boolean
} {
  if (!types?.length) return { isRemote: false, isHybrid: false }
  const t = types.map((s) => s.toLowerCase())
  return {
    isRemote: t.some((s) => s.includes("remote")),
    isHybrid: t.some((s) => s.includes("hybrid")),
  }
}
