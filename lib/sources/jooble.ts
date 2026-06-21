/**
 * Jooble job search API client.
 *
 * Jooble is a global aggregator that crawls thousands of boards and company
 * sites. The API is a POST whose key is embedded in the URL path; the body
 * carries the query. Snippets are short HTML excerpts, not full descriptions.
 * Some rows lack a stable id, so we synthesize one from the apply link.
 *
 * Endpoint: POST https://jooble.org/api/{JOOBLE_API_KEY}
 *   body: { keywords, location, page? }
 * Requires a key (register at https://jooble.org/api/about). Free tier exists
 * with a per-day request cap; pricing scales beyond that.
 *
 * Env:
 *   JOOBLE_API_KEY  — required
 */

const JOOBLE_BASE = "https://jooble.org/api"
const REQUEST_TIMEOUT_MS = 12_000

export interface JoobleJob {
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
  salaryText?: string
  employmentType?: string
  source?: string
  isRemote: boolean
}

export interface JoobleSearchOptions {
  keywords: string
  location?: string
  page?: number
  /** Override the env key (primarily for tests). */
  apiKey?: string
  fetchImpl?: typeof fetch
}

export interface JoobleSearchResult {
  jobs: JoobleJob[]
  count: number
  page: number
}

export async function searchJoobleJobs(opts: JoobleSearchOptions): Promise<JoobleSearchResult> {
  const apiKey = opts.apiKey ?? process.env.JOOBLE_API_KEY
  if (!apiKey) throw new Error("JOOBLE_API_KEY is required")

  const doFetch = opts.fetchImpl ?? fetch
  const page = opts.page ?? 1

  const requestBody = JSON.stringify({
    keywords: opts.keywords,
    location: opts.location ?? "",
    page: String(page),
  })

  const res = await doFetch(`${JOOBLE_BASE}/${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: requestBody,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: "no-store",
  })

  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`Jooble API ${res.status} for "${opts.keywords}": ${body.slice(0, 200)}`)
  }

  const body = await res.json() as { jobs?: RawJoobleJob[]; totalCount?: number }
  const jobs = (body.jobs ?? []).map(mapJoobleJob).filter(Boolean) as JoobleJob[]
  return { jobs, count: body.totalCount ?? jobs.length, page }
}

// ── Raw API shape ─────────────────────────────────────────────────────────────

interface RawJoobleJob {
  id?: number | string
  title?: string
  location?: string
  snippet?: string
  salary?: string
  source?: string
  type?: string
  link?: string
  company?: string
  updated?: string
}

export function mapJoobleJob(raw: RawJoobleJob): JoobleJob | null {
  if (!raw.title || !raw.link) return null

  const location = (raw.location ?? "").trim()

  return {
    id: raw.id != null ? String(raw.id) : stableIdFromUrl(raw.link),
    title: raw.title.trim(),
    company: (raw.company ?? "").trim(),
    location,
    description: (raw.snippet ?? "").trim(),
    applyUrl: raw.link,
    postedAt: toIso(raw.updated),
    salaryText: raw.salary?.trim() || undefined,
    employmentType: normalizeEmploymentType(raw.type),
    source: raw.source?.trim() || undefined,
    isRemote: /remote/i.test(location) || /remote/i.test(raw.title),
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function stableIdFromUrl(url: string): string {
  let hash = 5381
  for (let i = 0; i < url.length; i++) {
    hash = ((hash << 5) + hash) ^ url.charCodeAt(i)
  }
  return `jooble-${(hash >>> 0).toString(36)}`
}

function toIso(value: string | undefined): string {
  if (!value) return new Date().toISOString()
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString()
}

function normalizeEmploymentType(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  switch (raw.toLowerCase().replace(/[\s_]+/g, "-")) {
    case "full-time": return "full-time"
    case "part-time": return "part-time"
    case "contract":  return "contract"
    case "internship":
    case "temporary": return raw.trim()
    default:          return raw.trim() || undefined
  }
}
