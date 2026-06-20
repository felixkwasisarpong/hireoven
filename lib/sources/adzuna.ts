/**
 * Adzuna job search API client.
 *
 * Adzuna aggregates LinkedIn, Indeed, company boards, and more — giving us a
 * broad "new postings today" signal without scraping those boards directly.
 * NOTE: descriptions are truncated at ~500 chars by the API. The redirect_url
 * always points to adzuna.com (behind AWS WAF), so back-fetching for full
 * descriptions is not feasible. Low-quality results are filtered at ingest.
 *
 * Register at https://developer.adzuna.com for free credentials.
 * Free tier: 250 calls/day, 50 results/page.
 *
 * Env:
 *   ADZUNA_APP_ID   — required
 *   ADZUNA_APP_KEY  — required
 */

const ADZUNA_BASE = "https://api.adzuna.com/v1/api/jobs"
const PAGE_SIZE = 50
const REQUEST_TIMEOUT_MS = 12_000
const ADZUNA_MAX_RETRIES = Math.max(1, Number(process.env.ADZUNA_MAX_RETRIES ?? "3"))
const ADZUNA_RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504])

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function retryDelayMs(response: Response | null, attempt: number): number {
  const retryAfter = Number(response?.headers.get("retry-after"))
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(retryAfter * 1000, 20_000)
  }
  return Math.min(800 * 2 ** (attempt - 1) + Math.random() * 500, 20_000)
}

export class AdzunaApiError extends Error {
  readonly status: number
  readonly query: string
  readonly bodyPreview: string
  readonly retryable: boolean

  constructor(status: number, query: string, bodyPreview = "") {
    super(`Adzuna API ${status || "network"} for "${query}"`)
    this.name = "AdzunaApiError"
    this.status = status
    this.query = query
    this.bodyPreview = bodyPreview
    this.retryable = status === 0 || ADZUNA_RETRYABLE_STATUSES.has(status)
  }
}

export interface AdzunaJob {
  id: string
  title: string
  company: string
  location: string
  description: string
  applyUrl: string
  created: string
  salaryMin?: number
  salaryMax?: number
  salaryIsPredicted: boolean
  contractType?: string
  category: string
}

export interface AdzunaSearchOptions {
  what: string
  country?: string
  where?: string
  maxDaysOld?: number
  page?: number
  sortBy?: "date" | "relevance" | "salary"
}

export interface AdzunaSearchResult {
  jobs: AdzunaJob[]
  count: number
  page: number
}

export async function searchAdzunaJobs(opts: AdzunaSearchOptions): Promise<AdzunaSearchResult> {
  const appId = process.env.ADZUNA_APP_ID
  const appKey = process.env.ADZUNA_APP_KEY
  if (!appId || !appKey) throw new Error("ADZUNA_APP_ID and ADZUNA_APP_KEY are required")

  const country = opts.country ?? "us"
  const page = opts.page ?? 1
  const params = new URLSearchParams({
    app_id: appId,
    app_key: appKey,
    results_per_page: String(PAGE_SIZE),
    what: opts.what,
    sort_by: opts.sortBy ?? "date",
  })
  if (opts.where) params.set("where", opts.where)
  if (opts.maxDaysOld) params.set("max_days_old", String(opts.maxDaysOld))

  const url = `${ADZUNA_BASE}/${country}/search/${page}?${params}`
  const headers = {
    Accept: "application/json",
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  }

  let lastError: AdzunaApiError | null = null
  for (let attempt = 1; attempt <= ADZUNA_MAX_RETRIES; attempt += 1) {
    let res: Response | null = null
    try {
      res = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        // Bypass Next.js fetch cache — without this, the patched fetch in App Router
        // may add unexpected headers or deduplicate requests incorrectly.
        cache: "no-store",
      })
    } catch {
      lastError = new AdzunaApiError(0, opts.what)
      if (attempt < ADZUNA_MAX_RETRIES) {
        await sleep(retryDelayMs(null, attempt))
        continue
      }
      throw lastError
    }

    if (res.ok) {
      const body = await res.json() as {
        results?: RawAdzunaJob[]
        count?: number
      }

      const jobs = (body.results ?? []).map(mapAdzunaJob).filter(Boolean) as AdzunaJob[]
      return { jobs, count: body.count ?? jobs.length, page }
    }

    const body = await res.text().catch(() => "")
    lastError = new AdzunaApiError(res.status, opts.what, body.slice(0, 200))
    if (!lastError.retryable || attempt === ADZUNA_MAX_RETRIES) throw lastError
    await sleep(retryDelayMs(res, attempt))
  }

  throw lastError ?? new AdzunaApiError(0, opts.what)
}

export async function searchAdzunaAllPages(
  opts: Omit<AdzunaSearchOptions, "page">,
  maxJobs = 500,
): Promise<AdzunaJob[]> {
  const all: AdzunaJob[] = []
  let page = 1

  while (all.length < maxJobs) {
    const result = await searchAdzunaJobs({ ...opts, page })
    all.push(...result.jobs)
    if (all.length >= result.count || result.jobs.length < PAGE_SIZE) break
    page++
  }

  return all.slice(0, maxJobs)
}

// ── Raw API shape ─────────────────────────────────────────────────────────────

interface RawAdzunaJob {
  id?: string
  title?: string
  company?: { display_name?: string }
  location?: { display_name?: string }
  description?: string
  redirect_url?: string
  created?: string
  salary_min?: number
  salary_max?: number
  salary_is_predicted?: string
  contract_type?: string
  category?: { label?: string }
}

function mapAdzunaJob(raw: RawAdzunaJob): AdzunaJob | null {
  if (!raw.id || !raw.title || !raw.company?.display_name) return null
  return {
    id: raw.id,
    title: raw.title.trim(),
    company: raw.company.display_name.trim(),
    location: raw.location?.display_name?.trim() ?? "",
    description: (raw.description ?? "").trim(),
    applyUrl: raw.redirect_url ?? `https://www.adzuna.com/land/ad/${raw.id}`,
    created: raw.created ?? new Date().toISOString(),
    salaryMin: raw.salary_min,
    salaryMax: raw.salary_max,
    salaryIsPredicted: raw.salary_is_predicted === "1",
    contractType: raw.contract_type,
    category: raw.category?.label ?? "",
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function adzunaContractToEmploymentType(contractType: string | undefined): string | null {
  switch (contractType) {
    case "permanent": return "full-time"
    case "contract":  return "contract"
    case "part_time": return "part-time"
    default:          return null
  }
}
