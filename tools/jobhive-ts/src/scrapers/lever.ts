/**
 * Lever — TS port of jobhive.scrapers.lever.
 *
 * Public board API (no auth): api.lever.co/v0/postings/{slug}?mode=json
 * A single request returns every posting with the full body inlined, so no
 * per-job detail fetch is needed. The body lives across two fields:
 * `description` (intro HTML) + a `lists` array of structured sections
 * (Responsibilities, Requirements, …); we concatenate them — the legacy
 * `descriptionPlain` omits the `lists` content, dropping most of the body.
 * `createdAt` is a ms-epoch posted-at.
 */

import { BaseScraper, register } from "../base.js"
import { fetchJson, cleanHtml, parseIso } from "../http.js"
import { CompanyNotFoundError, ScraperError, type EmploymentType, type ReplicaJob } from "../types.js"

type LeverList = { text?: string; content?: string }

type LeverJob = {
  id: string
  text?: string
  description?: string
  descriptionPlain?: string
  lists?: LeverList[]
  hostedUrl?: string
  applyUrl?: string
  workplaceType?: string
  createdAt?: number
  categories?: {
    location?: string
    commitment?: string
    team?: string
    department?: string
  }
  salaryRange?: {
    min?: number
    max?: number
    currency?: string
    interval?: string
  }
}

// `categories.commitment` is freeform employer text — map common variants to
// the canonical employment-type enum (substring match, longest keys unhurt).
const COMMITMENT_TO_EMPLOYMENT: Array<[string, EmploymentType]> = [
  ["full-time", "FULL_TIME"],
  ["fulltime", "FULL_TIME"],
  ["full time", "FULL_TIME"],
  ["regular", "FULL_TIME"],
  ["part-time", "PART_TIME"],
  ["parttime", "PART_TIME"],
  ["part time", "PART_TIME"],
  ["contract", "CONTRACT"],
  ["contractor", "CONTRACT"],
  ["consultant", "CONTRACT"],
  ["freelance", "CONTRACT"],
  ["fixed-term", "CONTRACT"],
  ["internship", "INTERN"],
  ["intern", "INTERN"],
  ["co-op", "INTERN"],
  ["temporary", "TEMPORARY"],
  ["temp", "TEMPORARY"],
  ["seasonal", "TEMPORARY"],
]

class LeverScraper extends BaseScraper {
  readonly ats = "lever"

  async fetch(slug: string): Promise<ReplicaJob[]> {
    const url = `https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`
    const res = await fetchJson<LeverJob[]>(url, { timeoutMs: 30_000 })
    if (!res.ok) {
      if (res.status === 404) throw new CompanyNotFoundError(`Lever board not found: ${slug}`)
      throw new ScraperError(`Lever ${slug} → ${res.reason}`)
    }
    return (res.data ?? []).map((j) => this.parse(j))
  }

  private parse(item: LeverJob): ReplicaJob {
    const cats = item.categories ?? {}

    // Body assembly: intro HTML + each `lists` section (heading + content),
    // falling back to the shorter plain-text field only if both are empty.
    const parts: string[] = []
    const intro = typeof item.description === "string" ? item.description : ""
    if (intro.trim()) parts.push(intro)
    for (const section of item.lists ?? []) {
      const heading = (section.text ?? "").trim()
      const content = (section.content ?? "").trim()
      if (!content) continue
      parts.push(heading ? `<h3>${heading}</h3>\n${content}` : content)
    }
    const rawBody = parts.length
      ? parts.join("\n\n")
      : typeof item.descriptionPlain === "string"
        ? item.descriptionPlain
        : undefined

    return {
      externalId: `lever:${item.id}`,
      title: item.text ?? "Untitled",
      applyUrl: item.hostedUrl ?? item.applyUrl ?? "",
      description: cleanHtml(rawBody),
      location: cats.location,
      postedAt: parseIso(item.createdAt),
      workMode: workModeOf(item.workplaceType),
      employmentType: employmentOf(cats.commitment),
      salaryMin: item.salaryRange?.min,
      salaryMax: item.salaryRange?.max,
      salaryCurrency: item.salaryRange?.currency,
    }
  }
}

function employmentOf(commitment: string | undefined): EmploymentType | undefined {
  if (typeof commitment !== "string") return undefined
  const norm = commitment.trim().toLowerCase()
  for (const [key, mapped] of COMMITMENT_TO_EMPLOYMENT) {
    if (norm.includes(key)) return mapped
  }
  return undefined
}

function workModeOf(workplaceType: string | undefined): string | undefined {
  const wp = (workplaceType ?? "").toLowerCase()
  if (wp === "remote") return "remote"
  if (wp === "hybrid") return "hybrid"
  if (wp === "on-site" || wp === "onsite" || wp === "in-office") return "onsite"
  return undefined
}

register(new LeverScraper())
