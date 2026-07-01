/**
 * Workday — TS port of jobhive.scrapers.workday, including the facet
 * subdivision that breaks Workday's 2,000-per-query cap.
 *
 * API: POST {base}/wday/cxs/{co}/{site}/jobs  body {appliedFacets,limit,offset,searchText}
 *
 * The API caps `limit` at 20 and caps the *reported total* at 2,000 — past
 * offset 2,000 it silently wraps to page 1, so naive pagination can never
 * exceed 2K jobs. When a query reports exactly 2,000 we subdivide by a facet
 * (jobFamilyGroup → timeType → locations → workerSubType); each child query
 * has its own ≤2K cap and dedup absorbs overlap. This is the technique the
 * harvester's workday.ts is missing.
 *
 * Accepts either a full careers URL or a `tenant:instance:site` tuple (the
 * harvester's ats_identifier shape). Descriptions are NOT fetched by default
 * (the win here is job *count*); pass JOBHIVE_WD_DETAILS=1 to hydrate them.
 */

import { BaseScraper, register } from "../base.js"
import { fetchJson, cleanHtml } from "../http.js"
import { CompanyNotFoundError, ScraperError, type EmploymentType, type ReplicaJob } from "../types.js"

const PAGE_LIMIT = 20
const QUERY_TOTAL_CAP = 2000
const MAX_SUBDIVISION_DEPTH = 4
const MAX_CONCURRENCY = 10
const MAX_RETRIES = 3
const SUBDIVISION_FACETS = ["jobFamilyGroup", "timeType", "locations", "workerSubType"]
const RETRYABLE = new Set([403, 429, 502, 503, 504])

// Numbered groups (not named) so the file typechecks under the project's
// es2017 target: [1]=company, [2]=instance (wdN), [3]=site.
const URL_RE = /^https?:\/\/([^.]+)\.(wd\d+)\.myworkdayjobs\.com\/([^/?#]+)/

const TIMETYPE_MAP: Record<string, EmploymentType> = {
  "full time": "FULL_TIME", "full_time": "FULL_TIME", fulltime: "FULL_TIME",
  "part time": "PART_TIME", "part_time": "PART_TIME", parttime: "PART_TIME",
  "fixed term": "CONTRACT", contract: "CONTRACT",
  intern: "INTERN", internship: "INTERN", temporary: "TEMPORARY",
}

type WdPosting = {
  title?: string
  externalPath?: string
  bulletFields?: string[]
  locationsText?: string
  timeType?: string
  remoteType?: string
  jobFamilyGroup?: string
}
type WdResponse = {
  total?: number
  jobPostings?: WdPosting[]
  facets?: Array<{ facetParameter?: string; values?: Array<{ id?: string; count?: number }> }>
}

class Semaphore {
  private queue: Array<() => void> = []
  private active = 0
  constructor(private readonly max: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((r) => this.queue.push(r))
    this.active++
    try {
      return await fn()
    } finally {
      this.active--
      this.queue.shift()?.()
    }
  }
}

function resolveApi(slug: string): { api: string; base: string; company: string } {
  let m = slug.trim().replace(/\/+$/, "").match(URL_RE)
  if (!m?.groups) {
    // tuple form tenant:instance:site
    const parts = slug.split(":")
    if (parts.length === 3 && /^wd\d+$/.test(parts[1])) {
      const [company, instance, site] = parts
      const url = `https://${company}.${instance}.myworkdayjobs.com/${site}`
      m = url.match(URL_RE)
    }
  }
  if (!m) {
    throw new ScraperError(`Workday slug must be a careers URL or tenant:wdN:site — got ${slug}`)
  }
  const [, company, instance, site] = m
  return {
    api: `https://${company}.${instance}.myworkdayjobs.com/wday/cxs/${company}/${site}/jobs`,
    base: `https://${company}.${instance}.myworkdayjobs.com/${site}`,
    company,
  }
}

class WorkdayScraper extends BaseScraper {
  readonly ats = "workday"

  async fetch(slug: string, signal?: AbortSignal): Promise<ReplicaJob[]> {
    const { api, base } = resolveApi(slug)
    const sem = new Semaphore(MAX_CONCURRENCY)
    const seen = new Set<string>()
    const jobs: ReplicaJob[] = []

    const absorb = (postings: WdPosting[] | undefined) => {
      for (const p of postings ?? []) {
        const job = this.parse(p, base)
        if (seen.has(job.externalId)) continue
        seen.add(job.externalId)
        jobs.push(job)
      }
    }

    await this.exhaust(api, sem, {}, absorb, 0, signal)
    return jobs
  }

  private async exhaust(
    api: string,
    sem: Semaphore,
    applied: Record<string, string[]>,
    absorb: (p: WdPosting[] | undefined) => void,
    depth: number,
    signal?: AbortSignal,
  ): Promise<void> {
    const first = await this.request(api, sem, applied, 0, signal)
    if (!first) return
    const total = Number(first.total ?? 0)
    absorb(first.jobPostings)
    if (total <= PAGE_LIMIT) return

    const capped = total === QUERY_TOTAL_CAP
    if (!capped) return this.fanOut(api, sem, applied, total, absorb, signal)

    if (depth >= MAX_SUBDIVISION_DEPTH) return this.fanOut(api, sem, applied, total, absorb, signal)

    const facet = pickFacet(first.facets ?? [], new Set(Object.keys(applied)))
    if (!facet) return this.fanOut(api, sem, applied, total, absorb, signal)

    const [param, values] = facet
    await Promise.all(
      values.map(([valueId]) =>
        this.exhaust(api, sem, { ...applied, [param]: [valueId] }, absorb, depth + 1, signal),
      ),
    )
  }

  private async fanOut(
    api: string,
    sem: Semaphore,
    applied: Record<string, string[]>,
    total: number,
    absorb: (p: WdPosting[] | undefined) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const offsets: number[] = []
    for (let o = PAGE_LIMIT; o < total; o += PAGE_LIMIT) offsets.push(o)
    const batches = await Promise.all(
      offsets.map((o) => this.request(api, sem, applied, o, signal).then((r) => r?.jobPostings)),
    )
    for (const b of batches) absorb(b)
  }

  private async request(
    api: string,
    sem: Semaphore,
    applied: Record<string, string[]>,
    offset: number,
    signal?: AbortSignal,
  ): Promise<WdResponse | null> {
    const body = JSON.stringify({ appliedFacets: applied, limit: PAGE_LIMIT, offset, searchText: "" })
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const res = await sem.run(() =>
        fetchJson<WdResponse>(api, { method: "POST", body, timeoutMs: 30_000, maxAttempts: 1, signal }),
      )
      if (res.ok) return res.data
      if (res.status === 404) throw new CompanyNotFoundError(`Workday site not found: ${api}`)
      if (res.status != null && RETRYABLE.has(res.status)) {
        await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt))
        continue
      }
      throw new ScraperError(`Workday ${api} offset=${offset} → ${res.reason}`)
    }
    throw new ScraperError(`Workday gave up after ${MAX_RETRIES} retries at offset=${offset}`)
  }

  private parse(item: WdPosting, base: string): ReplicaJob {
    const externalPath = item.externalPath ?? ""
    const atsId = item.bulletFields?.[0] || externalPath.split("/").pop() || "unknown"
    let employmentType: EmploymentType | undefined
    const tt = item.timeType?.trim().toLowerCase().replace(/-/g, " ")
    if (tt) {
      employmentType = TIMETYPE_MAP[tt]
      if (!employmentType) {
        for (const [needle, mapped] of Object.entries(TIMETYPE_MAP)) {
          if (tt.includes(needle)) { employmentType = mapped; break }
        }
      }
    }
    let workMode: string | undefined
    const rt = item.remoteType?.trim().toLowerCase()
    if (rt) {
      if (rt.includes("remote") && !rt.includes("hybrid")) workMode = "remote"
      else if (rt.includes("hybrid")) workMode = "hybrid"
      else if (rt.includes("site") || rt.includes("office")) workMode = "onsite"
    }
    return {
      externalId: `workday:${atsId}`,
      title: item.title ?? "Untitled",
      applyUrl: externalPath ? `${base}${externalPath}` : base,
      location: cleanHtml(item.locationsText),
      employmentType,
      workMode,
    }
  }
}

function pickFacet(
  facets: WdResponse["facets"],
  applied: Set<string>,
): [string, Array<[string, number]>] | null {
  const byParam: Record<string, Array<[string, number]>> = {}
  for (const f of facets ?? []) {
    const param = f.facetParameter
    const values = f.values ?? []
    if (!param || applied.has(param) || values.length < 2) continue
    const items = values
      .filter((v) => v.id && (v.count ?? 0) > 0)
      .map((v) => [v.id as string, Number(v.count)] as [string, number])
    if (items.length) byParam[param] = items
  }
  for (const pref of SUBDIVISION_FACETS) if (byParam[pref]) return [pref, byParam[pref]]
  const entries = Object.entries(byParam)
  if (entries.length) return entries.sort((a, b) => b[1].length - a[1].length)[0]
  return null
}

register(new WorkdayScraper())
