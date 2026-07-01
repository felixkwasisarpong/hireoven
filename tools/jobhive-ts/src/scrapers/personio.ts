/**
 * Personio — TS port of jobhive.scrapers.personio.
 *
 * Each Personio tenant is hosted at `{slug}.jobs.personio.com` (also `.com`/`.de`).
 * Two listing endpoints work in practice, tried in order:
 *
 *     GET https://{slug}.jobs.personio.com/search.json
 *     GET https://{slug}.jobs.personio.com/api/careers/jobs/list/
 *
 * The listing returns title/department/office/schedule plus a freeform
 * `employment_type` label, but the `description` field is always empty on the
 * public board. The full body lives on each job's HTML detail page inside a
 * `<div class="page_jobDescription…">` block — we fan out per-job HTML fetches
 * (capped, small concurrent pool) to fill descriptions best-effort. For the
 * benchmark, listing-level fields are the priority; detail is best-effort.
 *
 * The `slug` argument can be either the bare slug or the full base URL.
 */

import { BaseScraper, register } from "../base.js"
import { fetchJson, fetchText, cleanHtml, parseIso } from "../http.js"
import { CompanyNotFoundError, ScraperError, type EmploymentType, type ReplicaJob } from "../types.js"

const ENDPOINTS = ["/search.json", "/api/careers/jobs/list/"] as const
const DETAIL_MAX = 40 // cap detail fan-out
const DETAIL_CONCURRENCY = 8 // small concurrent pool for per-job HTML fetches

// Personio's `employment_type` is freeform — typical values include
// "Permanent employee", "Working student", "Internship", "Trainee",
// "Freelancer", "Fixed term contract". Map (first match wins) to the enum.
const EMPLOYMENT_TYPE_PATTERNS: [needle: string, mapped: EmploymentType][] = [
  ["intern", "INTERN"],
  ["trainee", "INTERN"],
  ["working student", "INTERN"],
  ["apprentice", "INTERN"],
  ["freelance", "CONTRACT"],
  ["freelancer", "CONTRACT"],
  ["contract", "CONTRACT"],
  ["fixed term", "CONTRACT"],
  ["fixed-term", "CONTRACT"],
  ["temp", "TEMPORARY"],
  ["temporary", "TEMPORARY"],
  ["seasonal", "TEMPORARY"],
  ["permanent", "FULL_TIME"],
  ["regular", "FULL_TIME"],
  ["full-time", "FULL_TIME"],
  ["fulltime", "FULL_TIME"],
  ["part-time", "PART_TIME"],
  ["parttime", "PART_TIME"],
]

type PersonioItem = {
  id?: unknown
  jobId?: unknown
  uuid?: unknown
  url?: string
  name?: string
  title?: string
  subcompany?: string
  department?: string | { name?: string }
  office?: string | { name?: string; city?: string }
  location?: string | { name?: string; city?: string }
  schedule?: string
  employment_type?: string
  employmentType?: string
  createdAt?: string
  created_at?: string
}

class PersonioScraper extends BaseScraper {
  readonly ats = "personio"

  async fetch(slug: string, signal?: AbortSignal): Promise<ReplicaJob[]> {
    const base = resolveBaseUrl(slug)
    let lastReason: string | null = null
    let jobs: ReplicaJob[] = []

    for (const path of ENDPOINTS) {
      const res = await fetchJson<unknown>(`${base}${path}`, { timeoutMs: 30_000, signal })
      if (!res.ok) {
        if (res.status === 404) continue
        lastReason = res.reason
        continue
      }
      const items = normalizeItems(res.data)
      if (items.length) {
        jobs = items.map((item) => parseJob(item, base))
        break
      }
    }

    if (!jobs.length) {
      if (lastReason) {
        throw new ScraperError(`Personio ${slug} → ${lastReason}`)
      }
      throw new CompanyNotFoundError(
        `Personio tenant ${slug} did not respond on any known endpoint`,
      )
    }

    await enrichDescriptions(jobs, signal)
    return jobs
  }
}

function resolveBaseUrl(slug: string): string {
  if (slug.startsWith("http://") || slug.startsWith("https://")) {
    return slug.replace(/\/+$/, "")
  }
  return `https://${slug}.jobs.personio.com`
}

function parseJob(item: PersonioItem, base: string): ReplicaJob {
  const atsId = String(item.id ?? item.jobId ?? item.uuid ?? "")

  let employmentType: EmploymentType | undefined
  for (const label of [item.employment_type, item.employmentType, item.schedule]) {
    if (typeof label === "string" && label.trim()) {
      const norm = label.trim().toLowerCase()
      const hit = EMPLOYMENT_TYPE_PATTERNS.find(([needle]) => norm.includes(needle))
      if (hit) {
        employmentType = hit[1]
        break
      }
    }
  }

  return {
    externalId: `personio:${atsId}`,
    title: item.name ?? item.title ?? item.subcompany ?? "Untitled",
    applyUrl: item.url ?? `${base}/job/${atsId}`,
    location: extractLocation(item),
    employmentType,
    postedAt: parseIso(item.createdAt ?? item.created_at),
  }
}

function normalizeItems(payload: unknown): PersonioItem[] {
  if (Array.isArray(payload)) {
    return payload.filter((p): p is PersonioItem => typeof p === "object" && p !== null)
  }
  if (payload && typeof payload === "object") {
    for (const key of ["data", "jobs", "results", "items"] as const) {
      const value = (payload as Record<string, unknown>)[key]
      if (Array.isArray(value)) {
        return value.filter((p): p is PersonioItem => typeof p === "object" && p !== null)
      }
    }
  }
  return []
}

function extractLocation(item: PersonioItem): string | undefined {
  if (typeof item.office === "string") return item.office
  const loc = item.location ?? item.office
  if (typeof loc === "string") return loc
  if (loc && typeof loc === "object") return loc.name ?? loc.city
  return undefined
}

/**
 * Fan out per-job HTML fetches (capped at DETAIL_MAX, concurrency
 * DETAIL_CONCURRENCY) and pull the description body out of the
 * `page_jobDescription` block. Best-effort — failures leave description unset.
 */
async function enrichDescriptions(jobs: ReplicaJob[], signal?: AbortSignal): Promise<void> {
  const targets = jobs.filter((j) => !j.description && j.applyUrl).slice(0, DETAIL_MAX)
  let cursor = 0

  async function worker(): Promise<void> {
    while (cursor < targets.length) {
      const job = targets[cursor++]
      const html = await fetchText(job.applyUrl, { timeoutMs: 20_000, signal })
      if (html) {
        const desc = extractDescription(html)
        if (desc) job.description = desc
      }
    }
  }

  const pool = Array.from({ length: Math.min(DETAIL_CONCURRENCY, targets.length) }, worker)
  await Promise.all(pool)
}

/**
 * Pull the description body from a Personio detail page. Personio renders the
 * body inside a `<div class="page_jobDescription…">` block (the suffix is a
 * build-hashed CSS-modules class, so we match on the prefix). Returns plain
 * text via cleanHtml, capped at 25k.
 */
function extractDescription(html: string): string | undefined {
  const idx = html.search(/class\s*=\s*["'][^"']*page_jobDescription/i)
  if (idx === -1) return undefined

  // Walk from the matched element's opening tag, tracking <div> nesting so we
  // capture the whole block rather than just the first inner element.
  const openTag = html.lastIndexOf("<", idx)
  if (openTag === -1) return undefined
  const bodyStart = html.indexOf(">", idx)
  if (bodyStart === -1) return undefined

  let depth = 1
  let pos = bodyStart + 1
  const tagRe = /<(\/?)div\b/gi
  tagRe.lastIndex = pos
  let end = html.length
  let m: RegExpExecArray | null
  while ((m = tagRe.exec(html)) !== null) {
    depth += m[1] ? -1 : 1
    if (depth === 0) {
      end = m.index
      break
    }
  }

  return cleanHtml(html.slice(bodyStart + 1, end))
}

register(new PersonioScraper())
