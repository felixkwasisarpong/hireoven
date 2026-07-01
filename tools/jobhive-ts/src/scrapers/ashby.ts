/**
 * Ashby — TS port of jobhive.scrapers.ashby.
 *
 * Public JSON board (no auth): api.ashbyhq.com/posting-api/job-board/{slug}
 * `?includeCompensation=true` inlines the rich compensation tiers so we can
 * surface salary min/max/currency without a per-job detail fetch. Each job
 * carries an inline HTML description, so one GET covers the whole board.
 */

import { BaseScraper, register } from "../base.js"
import { fetchJson, cleanHtml, parseIso } from "../http.js"
import {
  CompanyNotFoundError,
  ScraperError,
  type EmploymentType,
  type ReplicaJob,
} from "../types.js"

type AshbyComponent = {
  compensationType?: string
  minValue?: number
  maxValue?: number
  currencyCode?: string
}

type AshbyTier = {
  components?: AshbyComponent[]
}

type AshbyCompensation = {
  compensationTiers?: AshbyTier[]
}

type AshbyJob = {
  id: string
  title?: string
  location?: string
  employmentType?: string
  isRemote?: boolean
  workplaceType?: string
  jobUrl?: string
  applyUrl?: string
  descriptionHtml?: string
  descriptionPlain?: string
  publishedAt?: string
  compensation?: AshbyCompensation
}

const EMPLOYMENT_TYPE_MAP: Record<string, EmploymentType> = {
  FULLTIME: "FULL_TIME",
  FULL_TIME: "FULL_TIME",
  PARTTIME: "PART_TIME",
  PART_TIME: "PART_TIME",
  CONTRACT: "CONTRACT",
  INTERNSHIP: "INTERN",
  INTERN: "INTERN",
  TEMPORARY: "TEMPORARY",
}

class AshbyScraper extends BaseScraper {
  readonly ats = "ashby"

  async fetch(slug: string): Promise<ReplicaJob[]> {
    const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}?includeCompensation=true`
    const res = await fetchJson<{ jobs?: AshbyJob[] }>(url, { timeoutMs: 30_000 })
    if (!res.ok) {
      if (res.status === 404) throw new CompanyNotFoundError(`Ashby board not found: ${slug}`)
      throw new ScraperError(`Ashby ${slug} → ${res.reason}`)
    }
    return (res.data.jobs ?? []).map((j) => this.parse(j))
  }

  private parse(item: AshbyJob): ReplicaJob {
    const emp = (item.employmentType ?? "").toUpperCase()
    const employmentType = EMPLOYMENT_TYPE_MAP[emp]

    // `isRemote` is only set when truly remote; fall back to `workplaceType`.
    // Hybrid stays undefined — neither flag captures it cleanly.
    let workMode: string | undefined
    if (typeof item.isRemote === "boolean") {
      workMode = item.isRemote ? "remote" : "onsite"
    } else if (typeof item.workplaceType === "string") {
      const wp = item.workplaceType.trim().toLowerCase().replace(/[-\s]/g, "")
      if (wp === "remote") workMode = "remote"
      else if (wp === "onsite" || wp === "inperson" || wp === "office") workMode = "onsite"
    }

    const { salaryMin, salaryMax, salaryCurrency } = parseComp(item.compensation)

    return {
      externalId: `ashby:${item.id}`,
      title: item.title ?? "Untitled",
      applyUrl: item.jobUrl ?? item.applyUrl ?? "",
      // Prefer HTML (retains structure) over the plain-text concatenation.
      description: cleanHtml(item.descriptionHtml ?? item.descriptionPlain),
      location: item.location,
      postedAt: parseIso(item.publishedAt),
      workMode,
      employmentType,
      salaryMin,
      salaryMax,
      salaryCurrency,
    }
  }
}

/**
 * Pull structured min/max/currency from the Salary component of a
 * compensation tier. Ashby returns multiple component types (Salary, Bonus,
 * Commission, Equity); only Salary is surfaced as min/max.
 */
function parseComp(comp: AshbyCompensation | undefined): {
  salaryMin?: number
  salaryMax?: number
  salaryCurrency?: string
} {
  if (!comp) return {}
  for (const tier of comp.compensationTiers ?? []) {
    for (const component of tier.components ?? []) {
      if (component.compensationType !== "Salary") continue
      return {
        salaryMin: component.minValue,
        salaryMax: component.maxValue,
        salaryCurrency: component.currencyCode,
      }
    }
  }
  return {}
}

register(new AshbyScraper())
