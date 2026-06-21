/**
 * The Muse job search API client.
 *
 * The Muse publishes curated roles from companies that pay to be featured —
 * skewing toward editorial/brand-forward employers (tech, media, finance).
 * Descriptions arrive as HTML in `contents`. Locations may include the literal
 * string "Flexible / Remote", which we treat as a remote signal.
 *
 * Endpoint: GET https://www.themuse.com/api/public/jobs?page=N
 * Keyless. An optional api_key raises the rate limit (register at
 * https://www.themuse.com/developers/api/v2).
 * Free tier: ~3600 requests/hour unauthenticated; results paginate at 20/page.
 *
 * Env:
 *   THE_MUSE_API_KEY  — optional (raises rate limit)
 */

const THE_MUSE_BASE = "https://www.themuse.com/api/public/jobs"
const PAGE_SIZE = 20
const REQUEST_TIMEOUT_MS = 12_000

export interface TheMuseJob {
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
  employmentType?: string
  isRemote: boolean
}

export interface TheMuseSearchOptions {
  page?: number
  category?: string
  level?: string
  location?: string
  fetchImpl?: typeof fetch
}

export interface TheMuseSearchResult {
  jobs: TheMuseJob[]
  count: number
  page: number
}

export async function searchTheMuseJobs(opts: TheMuseSearchOptions = {}): Promise<TheMuseSearchResult> {
  const doFetch = opts.fetchImpl ?? fetch
  const page = opts.page ?? 0

  const params = new URLSearchParams({ page: String(page) })
  if (opts.category) params.append("category", opts.category)
  if (opts.level) params.append("level", opts.level)
  if (opts.location) params.append("location", opts.location)
  if (process.env.THE_MUSE_API_KEY) params.set("api_key", process.env.THE_MUSE_API_KEY)

  const res = await doFetch(`${THE_MUSE_BASE}?${params}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: "no-store",
  })

  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`The Muse API ${res.status}: ${body.slice(0, 200)}`)
  }

  const body = await res.json() as { results?: RawTheMuseJob[]; page_count?: number }
  const jobs = (body.results ?? []).map(mapTheMuseJob).filter(Boolean) as TheMuseJob[]
  return { jobs, count: body.page_count ?? jobs.length, page }
}

export async function searchTheMuseAllPages(
  opts: Omit<TheMuseSearchOptions, "page"> = {},
  maxPages = 5,
): Promise<TheMuseJob[]> {
  const all: TheMuseJob[] = []

  for (let page = 0; page < maxPages; page++) {
    const result = await searchTheMuseJobs({ ...opts, page })
    all.push(...result.jobs)
    if (result.jobs.length < PAGE_SIZE) break
  }

  return all
}

// ── Raw API shape ─────────────────────────────────────────────────────────────

interface RawTheMuseJob {
  id?: number | string
  name?: string
  contents?: string
  publication_date?: string
  company?: { name?: string }
  locations?: { name?: string }[]
  levels?: { name?: string }[]
  refs?: { landing_page?: string }
}

export function mapTheMuseJob(raw: RawTheMuseJob): TheMuseJob | null {
  if (raw.id == null || !raw.name || !raw.company?.name) return null

  const location = (raw.locations ?? [])
    .map((l) => l?.name)
    .filter(Boolean)
    .join(", ")

  return {
    id: String(raw.id),
    title: raw.name.trim(),
    company: raw.company.name.trim(),
    location,
    description: (raw.contents ?? "").trim(),
    applyUrl: raw.refs?.landing_page ?? "",
    postedAt: raw.publication_date ?? new Date().toISOString(),
    employmentType: raw.levels?.[0]?.name?.trim() || undefined,
    isRemote: /remote/i.test(location),
  }
}
