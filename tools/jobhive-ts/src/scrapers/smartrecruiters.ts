/**
 * SmartRecruiters — TS port of jobhive.scrapers.smartrecruiters.
 *
 * Listing API (no auth, paginated):
 *   GET https://api.smartrecruiters.com/v1/companies/{slug}/postings?limit=100&offset={n}
 *   → { content: [...], totalFound }
 * The listing carries title/location/typeOfEmployment but *not* the description
 * body. The detail endpoint adds it:
 *   GET https://api.smartrecruiters.com/v1/companies/{slug}/postings/{id}
 *   → jobAd.sections.{jobDescription,qualifications,additionalInformation,companyDescription}.text (HTML)
 *
 * Detail fan-out is capped (40 jobs, concurrency ~8) so a single scrape stays cheap.
 */

import { BaseScraper, register } from "../base.js"
import { fetchJson, cleanHtml, parseIso } from "../http.js"
import { CompanyNotFoundError, ScraperError, type EmploymentType, type ReplicaJob } from "../types.js"

const API_TEMPLATE = "https://api.smartrecruiters.com/v1/companies"
const PAGE_LIMIT = 100
const DETAIL_CAP = 40
const DETAIL_CONCURRENCY = 8

type SrLocation = {
  city?: string
  region?: string
  country?: string
  remote?: boolean
}

type SrTypeObj = { id?: string; label?: string }

type SrPosting = {
  id: string
  name?: string
  location?: SrLocation
  typeOfEmployment?: SrTypeObj
  releasedDate?: string
  createdOn?: string
}

type SrSection = { title?: string; text?: string }

type SrDetail = {
  applyUrl?: string
  jobAd?: {
    sections?: Record<string, SrSection>
  }
}

// `typeOfEmployment.id` is a stable enum; label is a localised display string.
const EMPLOYMENT_TYPE_MAP: Record<string, EmploymentType> = {
  permanent: "FULL_TIME",
  regular: "FULL_TIME",
  full_time: "FULL_TIME",
  fulltime: "FULL_TIME",
  part_time: "PART_TIME",
  parttime: "PART_TIME",
  contract: "CONTRACT",
  contractor: "CONTRACT",
  freelance: "CONTRACT",
  fixed_term: "CONTRACT",
  intern: "INTERN",
  internship: "INTERN",
  trainee: "INTERN",
  apprentice: "INTERN",
  temporary: "TEMPORARY",
  seasonal: "TEMPORARY",
  casual: "TEMPORARY",
}

class SmartRecruitersScraper extends BaseScraper {
  readonly ats = "smartrecruiters"

  async fetch(slug: string, signal?: AbortSignal): Promise<ReplicaJob[]> {
    const base = `${API_TEMPLATE}/${encodeURIComponent(slug)}/postings`
    const jobs: ReplicaJob[] = []
    const postings: SrPosting[] = []
    let offset = 0

    // Paginate the listing fully.
    for (;;) {
      const url = `${base}?limit=${PAGE_LIMIT}&offset=${offset}`
      const res = await fetchJson<{ content?: SrPosting[] }>(url, { timeoutMs: 30_000, signal })
      if (!res.ok) {
        if (res.status === 404) throw new CompanyNotFoundError(`SmartRecruiters company not found: ${slug}`)
        throw new ScraperError(`SmartRecruiters ${slug} → ${res.reason}`)
      }
      const content = res.data.content ?? []
      for (const item of content) {
        postings.push(item)
        jobs.push(this.parse(slug, item))
      }
      if (content.length < PAGE_LIMIT) break
      offset += PAGE_LIMIT
    }

    // Detail fan-out for descriptions: cap at 40 jobs, concurrency ~8.
    const targets = jobs.slice(0, DETAIL_CAP)
    let cursor = 0
    const worker = async (): Promise<void> => {
      for (;;) {
        const i = cursor++
        if (i >= targets.length) return
        await this.enrichDetail(slug, postings[i].id, targets[i], signal)
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(DETAIL_CONCURRENCY, targets.length) }, () => worker()),
    )

    return jobs
  }

  private parse(slug: string, item: SrPosting): ReplicaJob {
    const loc = item.location
    const type = item.typeOfEmployment
    return {
      externalId: `smartrecruiters:${item.id}`,
      title: item.name ?? "Untitled",
      applyUrl: `https://jobs.smartrecruiters.com/${encodeURIComponent(slug)}/${item.id}`,
      location: formatLocation(loc),
      postedAt: parseIso(item.releasedDate) ?? parseIso(item.createdOn),
      workMode: workModeOf(loc),
      employmentType: mapEmploymentType(type?.id) ?? mapEmploymentType(type?.label),
    }
  }

  private async enrichDetail(
    slug: string,
    id: string,
    job: ReplicaJob,
    signal?: AbortSignal,
  ): Promise<void> {
    const url = `${API_TEMPLATE}/${encodeURIComponent(slug)}/postings/${id}`
    const res = await fetchJson<SrDetail>(url, { timeoutMs: 30_000, signal })
    if (!res.ok) return

    const sections = res.data.jobAd?.sections
    if (sections) {
      const parts: string[] = []
      // Job description first so the most relevant content survives truncation.
      for (const key of ["jobDescription", "qualifications", "additionalInformation", "companyDescription"]) {
        const text = sections[key]?.text
        const cleaned = cleanHtml(text)
        if (cleaned) parts.push(cleaned)
      }
      if (parts.length) job.description = parts.join("\n\n").slice(0, 25_000)
    }

    const applyUrl = res.data.applyUrl
    if (typeof applyUrl === "string" && applyUrl.trim()) job.applyUrl = applyUrl.trim()
  }
}

function formatLocation(loc: SrLocation | undefined): string | undefined {
  if (!loc) return undefined
  const parts = [loc.city, loc.region, loc.country]
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .map((v) => v.trim())
  return parts.length ? parts.join(", ") : undefined
}

function workModeOf(loc: SrLocation | undefined): string | undefined {
  if (!loc) return undefined
  if (loc.remote === true || loc.country === "remote") return "remote"
  if (loc.remote === false) return "onsite"
  return undefined
}

function mapEmploymentType(value: string | undefined): EmploymentType | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined
  const norm = value.trim().toLowerCase().replace(/-/g, "_").replace(/ /g, "_")
  if (norm in EMPLOYMENT_TYPE_MAP) return EMPLOYMENT_TYPE_MAP[norm]
  for (const needle in EMPLOYMENT_TYPE_MAP) {
    if (norm.includes(needle)) return EMPLOYMENT_TYPE_MAP[needle]
  }
  return undefined
}

register(new SmartRecruitersScraper())
