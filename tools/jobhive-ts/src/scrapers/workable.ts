/**
 * Workable — TS port of jobhive.scrapers.workable.
 *
 * Public widget API (no auth):
 *   GET https://apply.workable.com/api/v1/widget/accounts/{slug}
 * One JSON payload with `jobs[]` carrying title / location / employment
 * shape / dates — but NOT the description body.
 *
 * Descriptions come from Workable's per-job Markdown render:
 *   GET https://apply.workable.com/{slug}/jobs/view/{shortcode}.md
 * That fetch is best-effort so a listing row survives when a detail
 * request is rate-limited (Workable 429s hard from a single IP), and the
 * fan-out is capped + low-concurrency to stay under the per-tenant limit.
 */

import { BaseScraper, register } from "../base.js"
import { fetchJson, fetchText, parseIso } from "../http.js"
import {
  CompanyNotFoundError,
  ScraperError,
  type EmploymentType,
  type ReplicaJob,
} from "../types.js"

type WkLocation = {
  city?: string
  region?: string
  state?: string
  country?: string
}

type WkJob = {
  id?: number | string
  shortcode?: string
  code?: string
  title?: string
  url?: string
  application_url?: string
  type?: string
  employment_type?: string
  department?: string
  telecommuting?: boolean
  remote?: boolean
  city?: string
  state?: string
  country?: string
  location?: WkLocation
  locations?: WkLocation[]
  published_on?: string
  created_at?: string
}

const API_TEMPLATE = (slug: string) =>
  `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(slug)}`
const MARKDOWN_TEMPLATE = (slug: string, shortcode: string) =>
  `https://apply.workable.com/${encodeURIComponent(slug)}/jobs/view/${encodeURIComponent(shortcode)}.md`

/** Cap the per-job detail fan-out so a big board can't hammer the tenant. */
const DETAIL_CAP = 40
const DETAIL_CONCURRENCY = 8

const EMPLOYMENT_TYPE_PATTERNS: Array<[string, EmploymentType]> = [
  ["internship", "INTERN"],
  ["intern", "INTERN"],
  ["trainee", "INTERN"],
  ["contractor", "CONTRACT"],
  ["contract", "CONTRACT"],
  ["freelance", "CONTRACT"],
  ["fixed-term", "CONTRACT"],
  ["fixed term", "CONTRACT"],
  ["temporary", "TEMPORARY"],
  ["casual", "TEMPORARY"],
  ["seasonal", "TEMPORARY"],
  ["part-time", "PART_TIME"],
  ["part time", "PART_TIME"],
  ["parttime", "PART_TIME"],
  ["full-time", "FULL_TIME"],
  ["full time", "FULL_TIME"],
  ["fulltime", "FULL_TIME"],
  ["permanent", "FULL_TIME"],
]

class WorkableScraper extends BaseScraper {
  readonly ats = "workable"

  async fetch(slug: string, signal?: AbortSignal): Promise<ReplicaJob[]> {
    const res = await fetchJson<{ jobs?: WkJob[] }>(API_TEMPLATE(slug), {
      timeoutMs: 30_000,
      maxAttempts: 4,
      headers: { accept: "application/json" },
      signal,
    })
    if (!res.ok) {
      if (res.status === 404) throw new CompanyNotFoundError(`Workable account not found: ${slug}`)
      throw new ScraperError(`Workable ${slug} → ${res.reason}`)
    }

    const jobs = (res.data.jobs ?? []).map((item) => this.parse(item, slug))
    await this.enrichDescriptions(slug, jobs, signal)
    return jobs
  }

  /**
   * Pull the Markdown body for jobs missing a description, from
   * `/{slug}/jobs/view/{shortcode}.md`. Best-effort, capped fan-out,
   * low concurrency so we stay under the per-tenant rate limit.
   */
  private async enrichDescriptions(
    slug: string,
    jobs: ReplicaJob[],
    signal?: AbortSignal,
  ): Promise<void> {
    const targets = jobs.filter((j) => !j.description).slice(0, DETAIL_CAP)
    if (targets.length === 0) return

    let cursor = 0
    const worker = async (): Promise<void> => {
      while (cursor < targets.length) {
        if (signal?.aborted) return
        const job = targets[cursor++]
        const shortcode = job.externalId.slice("workable:".length)
        if (!shortcode) continue
        const md = await fetchText(MARKDOWN_TEMPLATE(slug, shortcode), {
          timeoutMs: 30_000,
          headers: { accept: "text/markdown" },
          signal,
        })
        const text = md?.trim()
        if (text) job.description = text.slice(0, 25_000)
      }
    }

    const pool = Array.from({ length: Math.min(DETAIL_CONCURRENCY, targets.length) }, worker)
    await Promise.all(pool)
  }

  private parse(item: WkJob, slug: string): ReplicaJob {
    const shortcode =
      item.shortcode || item.code || (item.id != null ? String(item.id) : "")

    const commitmentRaw = item.type || item.employment_type
    const commitment =
      typeof commitmentRaw === "string" && commitmentRaw.trim()
        ? commitmentRaw.trim()
        : undefined

    let employmentType: EmploymentType | undefined
    if (commitment) {
      const norm = commitment.toLowerCase()
      for (const [needle, mapped] of EMPLOYMENT_TYPE_PATTERNS) {
        if (norm.includes(needle)) {
          employmentType = mapped
          break
        }
      }
    }

    let workMode: string | undefined
    const isRemote =
      typeof item.telecommuting === "boolean"
        ? item.telecommuting
        : typeof item.remote === "boolean"
          ? item.remote
          : undefined
    if (isRemote === true) workMode = "remote"
    else if (isRemote === false) workMode = "onsite"

    const url = item.url || item.application_url || ""

    return {
      externalId: `workable:${shortcode}`,
      title: item.title ?? "Untitled",
      applyUrl: url,
      description: undefined, // filled by enrichDescriptions from the .md endpoint
      location: extractLocation(item),
      postedAt: parseIso(item.published_on) ?? parseIso(item.created_at),
      workMode,
      employmentType,
    }
  }
}

/**
 * Workable exposes location several ways; try the richest first:
 *   - structured `locations[]` (recent API)
 *   - nested `location: {city, region, country}` (widget payload)
 *   - flat `city` / `state` / `country`
 */
function extractLocation(item: WkJob): string | undefined {
  const fromLoc = (l: WkLocation | undefined): string | undefined => {
    if (!l) return undefined
    const joined = [l.city, l.region, l.country].filter(Boolean).join(", ")
    return joined || undefined
  }

  if (Array.isArray(item.locations) && item.locations.length > 0) {
    const j = fromLoc(item.locations[0])
    if (j) return j
  }
  const nested = fromLoc(item.location)
  if (nested) return nested

  const flat = [item.city, item.state, item.country].filter(Boolean).join(", ")
  return flat || undefined
}

register(new WorkableScraper())
