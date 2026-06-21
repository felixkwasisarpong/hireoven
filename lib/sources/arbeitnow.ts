/**
 * Arbeitnow job-board API client.
 *
 * Arbeitnow aggregates roles with a strong European (esp. German) skew, but the
 * board includes remote and visa-sponsored listings worldwide. Each row carries
 * a boolean `remote` flag we map directly. `created_at` may arrive as unix
 * seconds or an ISO string — we normalize both to ISO. The `slug` is the stable
 * identifier (the API has no numeric id).
 *
 * Endpoint: GET https://www.arbeitnow.com/api/job-board-api
 * Keyless. Free and unauthenticated; paginated via Laravel-style `?page=N`.
 *
 * Env: none.
 */

const ARBEITNOW_BASE = "https://www.arbeitnow.com/api/job-board-api"
const REQUEST_TIMEOUT_MS = 12_000
const PAGE_SIZE = 100

export interface ArbeitnowJob {
  id: string
  title: string
  company: string
  companyDomain?: string
  location: string
  description: string
  applyUrl: string
  postedAt: string
  salaryMin?: number
  salaryMax?: number
  salaryCurrency?: string
  tags?: string[]
  employmentType?: string
  isRemote: boolean
}

export interface ArbeitnowSearchOptions {
  page?: number
  fetchImpl?: typeof fetch
}

export interface ArbeitnowSearchResult {
  jobs: ArbeitnowJob[]
  count: number
  page: number
}

export async function searchArbeitnowJobs(opts: ArbeitnowSearchOptions = {}): Promise<ArbeitnowSearchResult> {
  const doFetch = opts.fetchImpl ?? fetch
  const page = opts.page ?? 1

  const res = await doFetch(`${ARBEITNOW_BASE}?page=${page}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: "no-store",
  })

  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`Arbeitnow API ${res.status}: ${body.slice(0, 200)}`)
  }

  const body = await res.json() as { data?: RawArbeitnowJob[] }
  const jobs = (body.data ?? []).map(mapArbeitnowJob).filter(Boolean) as ArbeitnowJob[]
  return { jobs, count: jobs.length, page }
}

export async function searchArbeitnowAllPages(
  opts: Omit<ArbeitnowSearchOptions, "page"> = {},
  maxPages = 5,
): Promise<ArbeitnowJob[]> {
  const all: ArbeitnowJob[] = []

  for (let page = 1; page <= maxPages; page++) {
    const result = await searchArbeitnowJobs({ ...opts, page })
    all.push(...result.jobs)
    if (result.jobs.length < PAGE_SIZE) break
  }

  return all
}

// ── Raw API shape ─────────────────────────────────────────────────────────────

interface RawArbeitnowJob {
  slug?: string
  title?: string
  company_name?: string
  url?: string
  location?: string
  remote?: boolean
  description?: string
  created_at?: number | string
  job_types?: string[]
  tags?: string[]
}

export function mapArbeitnowJob(raw: RawArbeitnowJob): ArbeitnowJob | null {
  if (!raw.slug || !raw.title || !raw.company_name) return null

  return {
    id: raw.slug,
    title: raw.title.trim(),
    company: raw.company_name.trim(),
    location: (raw.location ?? "").trim(),
    description: (raw.description ?? "").trim(),
    applyUrl: raw.url ?? "",
    postedAt: toIso(raw.created_at),
    tags: Array.isArray(raw.tags) ? raw.tags.filter(Boolean) : undefined,
    employmentType: normalizeEmploymentType(raw.job_types?.[0]),
    isRemote: raw.remote === true,
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toIso(value: number | string | undefined): string {
  if (value == null) return new Date().toISOString()
  if (typeof value === "number") return new Date(value * 1000).toISOString()
  // Numeric string (unix seconds) vs ISO string.
  if (/^\d+$/.test(value)) return new Date(Number(value) * 1000).toISOString()
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString()
}

function normalizeEmploymentType(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  switch (raw.toLowerCase().replace(/[\s_]+/g, "-")) {
    case "full-time": return "full-time"
    case "part-time": return "part-time"
    case "contract":  return "contract"
    case "internship": return "internship"
    default:          return raw.trim() || undefined
  }
}
