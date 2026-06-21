/**
 * RemoteOK remote-jobs API client.
 *
 * RemoteOK returns a single JSON ARRAY whose FIRST element is a legal/disclaimer
 * object (no `id`/`position`) that must be skipped — we filter out any element
 * lacking both. Every real row is a fully-remote role, so isRemote is always
 * true. There is no pagination; the endpoint returns the current active set.
 *
 * Endpoint: GET https://remoteok.com/api
 * Keyless. RemoteOK requires a non-default User-Agent and asks for attribution
 * plus light caching. Free and unauthenticated.
 *
 * Env: none.
 */

const REMOTE_OK_BASE = "https://remoteok.com/api"
const REQUEST_TIMEOUT_MS = 12_000
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

export interface RemoteOkJob {
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

export interface RemoteOkSearchOptions {
  fetchImpl?: typeof fetch
}

export interface RemoteOkSearchResult {
  jobs: RemoteOkJob[]
  count: number
}

export async function searchRemoteOkJobs(opts: RemoteOkSearchOptions = {}): Promise<RemoteOkSearchResult> {
  const doFetch = opts.fetchImpl ?? fetch

  const res = await doFetch(REMOTE_OK_BASE, {
    headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: "no-store",
  })

  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`RemoteOK API ${res.status}: ${body.slice(0, 200)}`)
  }

  const body = await res.json() as RawRemoteOkJob[]
  const rows = Array.isArray(body) ? body : []
  const jobs = rows.map(mapRemoteOkJob).filter(Boolean) as RemoteOkJob[]
  return { jobs, count: jobs.length }
}

// ── Raw API shape ─────────────────────────────────────────────────────────────

interface RawRemoteOkJob {
  id?: number | string
  slug?: string
  position?: string
  company?: string
  location?: string
  url?: string
  apply_url?: string
  date?: string
  description?: string
  tags?: string[]
  salary_min?: number
  salary_max?: number
}

export function mapRemoteOkJob(raw: RawRemoteOkJob): RemoteOkJob | null {
  // Skip the legal/disclaimer element and any junk row missing required fields.
  if (raw.id == null || !raw.position || !raw.company) return null

  return {
    id: String(raw.id),
    title: raw.position.trim(),
    company: raw.company.trim(),
    location: (raw.location ?? "").trim(),
    description: (raw.description ?? "").trim(),
    applyUrl: raw.apply_url ?? raw.url ?? "",
    postedAt: raw.date ?? new Date().toISOString(),
    salaryMin: typeof raw.salary_min === "number" ? raw.salary_min : undefined,
    salaryMax: typeof raw.salary_max === "number" ? raw.salary_max : undefined,
    salaryCurrency: typeof raw.salary_min === "number" || typeof raw.salary_max === "number" ? "USD" : undefined,
    tags: Array.isArray(raw.tags) ? raw.tags.filter(Boolean) : undefined,
    isRemote: true,
  }
}
