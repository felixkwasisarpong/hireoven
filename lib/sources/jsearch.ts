/**
 * JSearch job search API client (via RapidAPI).
 *
 * JSearch aggregates LinkedIn, Indeed, Glassdoor, and ZipRecruiter — the
 * boards that block direct scraping. Each result includes the employer's
 * real website domain, which lets us create proper company rows (not just
 * name-slug placeholders) and detect their ATS immediately.
 *
 * Plans (RapidAPI): Free=200 req/mo · Basic=$10/500 · Pro=$30/1500
 * Each page = 10 results = 1 API request.
 *
 * Env:
 *   JSEARCH_API_KEY  — required (RapidAPI key)
 */

const JSEARCH_BASE = "https://jsearch.p.rapidapi.com/search"
const PAGE_SIZE = 10
const REQUEST_TIMEOUT_MS = 15_000

export interface JSearchJob {
  id: string
  title: string
  company: string
  companyDomain?: string
  companyLogo?: string
  location: string
  description: string
  applyUrl: string
  applyIsDirect: boolean
  postedAt: string
  isRemote: boolean
  employmentType?: string
  salaryMin?: number
  salaryMax?: number
  salaryCurrency?: string
  salaryPeriod?: string
  publisher: string
}

export interface JSearchOptions {
  query: string
  page?: number
  datePosted?: "all" | "today" | "3days" | "week" | "month"
  employmentTypes?: string
  remoteOnly?: boolean
}

export interface JSearchResult {
  jobs: JSearchJob[]
  page: number
}

export async function searchJSearchJobs(opts: JSearchOptions): Promise<JSearchResult> {
  const apiKey = process.env.JSEARCH_API_KEY
  if (!apiKey) throw new Error("JSEARCH_API_KEY is required")

  const params = new URLSearchParams({
    query: opts.query,
    page: String(opts.page ?? 1),
    num_pages: "1",
    date_posted: opts.datePosted ?? "today",
  })
  if (opts.employmentTypes) params.set("employment_types", opts.employmentTypes)
  if (opts.remoteOnly) params.set("remote_jobs_only", "true")

  const res = await fetch(`${JSEARCH_BASE}?${params}`, {
    headers: {
      Accept: "application/json",
      "X-RapidAPI-Key": apiKey,
      "X-RapidAPI-Host": "jsearch.p.rapidapi.com",
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: "no-store",
  })

  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`JSearch API ${res.status} for "${opts.query}": ${body.slice(0, 200)}`)
  }

  const body = await res.json() as { status?: string; data?: RawJSearchJob[] }
  if (body.status !== "OK") throw new Error(`JSearch non-OK status for "${opts.query}"`)

  const jobs = (body.data ?? []).map(mapJSearchJob).filter(Boolean) as JSearchJob[]
  return { jobs, page: opts.page ?? 1 }
}

export async function searchJSearchAllPages(
  opts: Omit<JSearchOptions, "page">,
  maxPages = 2,
): Promise<JSearchJob[]> {
  const all: JSearchJob[] = []

  for (let page = 1; page <= maxPages; page++) {
    const result = await searchJSearchJobs({ ...opts, page })
    all.push(...result.jobs)
    if (result.jobs.length < PAGE_SIZE) break
  }

  return all
}

// ── Raw API shape ─────────────────────────────────────────────────────────────

interface RawJSearchJob {
  job_id?: string
  employer_name?: string
  employer_website?: string
  employer_logo?: string
  job_title?: string
  job_apply_link?: string
  job_apply_is_direct?: boolean
  job_description?: string
  job_is_remote?: boolean
  job_posted_at_datetime_utc?: string
  job_city?: string
  job_state?: string
  job_country?: string
  job_employment_type?: string
  job_min_salary?: number
  job_max_salary?: number
  job_salary_currency?: string
  job_salary_period?: string
  job_publisher?: string
}

function mapJSearchJob(raw: RawJSearchJob): JSearchJob | null {
  if (!raw.job_id || !raw.job_title || !raw.employer_name) return null

  const parts = [raw.job_city, raw.job_state].filter(Boolean)
  const location = parts.length ? parts.join(", ") : (raw.job_country ?? "")

  return {
    id: raw.job_id,
    title: raw.job_title.trim(),
    company: raw.employer_name.trim(),
    companyDomain: cleanDomain(raw.employer_website),
    companyLogo: raw.employer_logo,
    location,
    description: (raw.job_description ?? "").trim(),
    applyUrl: raw.job_apply_link ?? "",
    applyIsDirect: raw.job_apply_is_direct ?? false,
    postedAt: raw.job_posted_at_datetime_utc ?? new Date().toISOString(),
    isRemote: raw.job_is_remote ?? false,
    employmentType: mapEmploymentType(raw.job_employment_type),
    salaryMin: raw.job_min_salary,
    salaryMax: raw.job_max_salary,
    salaryCurrency: raw.job_salary_currency ?? undefined,
    salaryPeriod: raw.job_salary_period ?? undefined,
    publisher: raw.job_publisher ?? "",
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function mapEmploymentType(raw: string | undefined): string | undefined {
  switch (raw) {
    case "FULLTIME":    return "full-time"
    case "PARTTIME":    return "part-time"
    case "CONTRACTOR":  return "contract"
    case "INTERN":      return "internship"
    default:            return undefined
  }
}

function cleanDomain(url: string | undefined): string | undefined {
  if (!url) return undefined
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`)
    const host = u.hostname.replace(/^www\./, "")
    return host || undefined
  } catch {
    return undefined
  }
}
