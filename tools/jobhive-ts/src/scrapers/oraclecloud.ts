/**
 * Oracle Recruiting Cloud (ORC / "oraclecloud") — TS port of jobhive.scrapers.oracle.
 *
 * Public CandidateExperience REST API (no auth):
 *   GET {base}/hcmRestApi/resources/latest/recruitingCEJobRequisitions
 *       ?onlyData=true&expand=requisitionList
 *       &finder=findReqs;siteNumber={site},limit=200,offset={n}
 *
 * Quirks faithfully preserved:
 *  - Pagination params (limit/offset) MUST live INSIDE the `finder` string;
 *    top-level limit/offset are silently ignored.
 *  - The job array is wrapped at `items[0].requisitionList`, and the real total
 *    is `items[0].TotalJobsCount` — only present with `expand=requisitionList`.
 *  - `slug` is the full careers URL (…/hcmUI/CandidateExperience/en/sites/CX_1),
 *    from which we derive the host root + site number. The harvester's
 *    `{pod}:{site}` / `custom:{host}:{site}` identifier form is also accepted.
 */

import { BaseScraper, register } from "../base.js"
import { fetchJson, cleanHtml, parseIso } from "../http.js"
import { CompanyNotFoundError, ScraperError, type EmploymentType, type ReplicaJob } from "../types.js"

const PAGE_LIMIT = 200
const MAX_PAGES = 25 // 5,000-job ceiling — Oracle tenants are small; keeps it bounded.
const DEFAULT_SITE = "CX_1"
const SITE_QUERY_RE = /site_number=([^&]+)/
const SITE_PATH_RE = /\/sites\/([^/?#]+)/

const REMOTE_BY_CODE: Record<string, string> = {
  ORA_REMOTE: "remote",
  ORA_FULL_TIME_REMOTE: "remote",
  ORA_ON_SITE: "onsite",
  ORA_ONSITE: "onsite",
  ORA_HYBRID: "hybrid",
}

// WorkerType / JobType / ContractType / JobSchedule label → employment type.
const EMPLOYMENT_PATTERNS: Array<[string, EmploymentType]> = [
  ["intern", "INTERN"], ["internship", "INTERN"], ["co-op", "INTERN"],
  ["temporary", "TEMPORARY"], ["seasonal", "TEMPORARY"],
  ["contractor", "CONTRACT"], ["contract", "CONTRACT"], ["fixed-term", "CONTRACT"], ["fixed term", "CONTRACT"],
  ["part-time", "PART_TIME"], ["part time", "PART_TIME"], ["parttime", "PART_TIME"],
  ["full-time", "FULL_TIME"], ["full time", "FULL_TIME"], ["fulltime", "FULL_TIME"],
  ["regular", "FULL_TIME"], ["permanent", "FULL_TIME"],
]

type OracleReq = {
  Id?: string | number
  RequisitionNumber?: string | number
  Title?: string
  PrimaryLocation?: string
  ShortDescriptionStr?: string
  WorkplaceTypeCode?: string
  WorkerType?: string
  JobType?: string
  ContractType?: string
  JobSchedule?: string
  PostedDate?: string
  CreatedOn?: string
  ExternalURL?: string
}
type OracleResponse = {
  items?: Array<{ requisitionList?: OracleReq[]; TotalJobsCount?: number }>
}

/** Resolve (host root, site number) from a careers URL or `{pod}:{site}` slug. */
function resolveTarget(slug: string): { base: string; site: string } {
  const raw = slug.trim()

  // Harvester identifier forms: "custom:{host}:{site}" or "{pod}:{site}".
  if (!/^https?:\/\//i.test(raw) && raw.includes(":")) {
    if (raw.startsWith("custom:")) {
      const rest = raw.slice("custom:".length)
      const idx = rest.lastIndexOf(":")
      if (idx > 0) return { base: `https://${rest.slice(0, idx)}`, site: rest.slice(idx + 1) || DEFAULT_SITE }
    } else {
      const idx = raw.lastIndexOf(":")
      const pod = raw.slice(0, idx)
      const site = raw.slice(idx + 1) || DEFAULT_SITE
      if (pod) return { base: `https://${pod}.oraclecloud.com`, site }
    }
  }

  // Full careers URL.
  const siteFromQuery = SITE_QUERY_RE.exec(raw)?.[1]
  let url: URL | null = null
  try {
    url = new URL(raw)
  } catch {
    /* not a URL */
  }
  if (url) {
    const site = siteFromQuery ?? SITE_PATH_RE.exec(url.pathname)?.[1] ?? DEFAULT_SITE
    return { base: `${url.protocol}//${url.host}`.replace(/\/+$/, ""), site }
  }
  return { base: raw.split("?")[0].replace(/\/+$/, ""), site: siteFromQuery ?? DEFAULT_SITE }
}

function unwrap(payload: OracleResponse): { reqs: OracleReq[]; total: number | null } {
  const item0 = payload.items?.[0]
  if (!item0) return { reqs: [], total: null }
  const reqs = Array.isArray(item0.requisitionList) ? item0.requisitionList : []
  return { reqs, total: item0.TotalJobsCount ?? null }
}

class OracleCloudScraper extends BaseScraper {
  readonly ats = "oraclecloud"

  async fetch(slug: string): Promise<ReplicaJob[]> {
    const { base, site } = resolveTarget(slug)
    if (!/^https?:\/\//i.test(base)) {
      throw new ScraperError(`oraclecloud: could not resolve a host from "${slug}"`)
    }
    const api = `${base}/hcmRestApi/resources/latest/recruitingCEJobRequisitions`
    const seen = new Set<string>()
    const jobs: ReplicaJob[] = []

    const absorb = (reqs: OracleReq[]) => {
      for (const item of reqs) {
        const job = this.parse(item, base, site)
        if (!job || seen.has(job.externalId)) continue
        seen.add(job.externalId)
        jobs.push(job)
      }
    }

    const first = await this.request(api, site, 0)
    const { reqs, total } = unwrap(first)
    absorb(reqs)
    if (total == null || total <= reqs.length || reqs.length === 0) return jobs

    // Page size = actual first-page length (Oracle may return <limit).
    const pageSize = Math.max(reqs.length, 1)
    for (let page = 1, offset = pageSize; offset < total && page < MAX_PAGES; page++, offset += pageSize) {
      const payload = await this.request(api, site, offset)
      const { reqs: pageReqs } = unwrap(payload)
      if (pageReqs.length === 0) break
      absorb(pageReqs)
    }
    return jobs
  }

  private async request(api: string, site: string, offset: number): Promise<OracleResponse> {
    const finder = `findReqs;siteNumber=${site},limit=${PAGE_LIMIT},offset=${offset}`
    const url = `${api}?onlyData=true&expand=requisitionList&finder=${encodeURIComponent(finder)}`
    const res = await fetchJson<OracleResponse>(url, { timeoutMs: 30_000, headers: { accept: "application/json" } })
    if (!res.ok) {
      if (res.status === 404) throw new CompanyNotFoundError(`Oracle site not found: ${api}`)
      throw new ScraperError(`Oracle ${api} offset=${offset} → ${res.reason}`)
    }
    return res.data
  }

  private parse(item: OracleReq, base: string, site: string): ReplicaJob | null {
    const atsId = String(item.Id ?? item.RequisitionNumber ?? "").trim()
    if (!atsId) return null

    let workMode: string | undefined
    const code = item.WorkplaceTypeCode?.trim().toUpperCase()
    if (code) workMode = REMOTE_BY_CODE[code]

    let employmentType: EmploymentType | undefined
    for (const key of [item.WorkerType, item.JobType, item.ContractType, item.JobSchedule]) {
      const norm = key?.trim().toLowerCase()
      if (!norm) continue
      const hit = EMPLOYMENT_PATTERNS.find(([needle]) => norm.includes(needle))
      if (hit) { employmentType = hit[1]; break }
    }

    return {
      externalId: `oraclecloud:${atsId}`,
      title: item.Title?.trim() || "Untitled",
      applyUrl:
        item.ExternalURL ||
        `${base}/?keyword=&mode=jobs&lang=en&site_number=${site}#${atsId}`,
      description: cleanHtml(item.ShortDescriptionStr),
      location: item.PrimaryLocation?.trim() || undefined,
      postedAt: parseIso(item.PostedDate) ?? parseIso(item.CreatedOn),
      workMode,
      employmentType,
    }
  }
}

register(new OracleCloudScraper())
