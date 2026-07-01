/**
 * Canonical output type for the jobhive-ts replica.
 *
 * Intentionally identical in shape to the harvester's `HarvestedJob`
 * (lib/harvester/adapters/_base.ts) so the benchmark can diff the two
 * crawlers field-for-field. The replica is a faithful TS port of the
 * Python `jobhive` scrapers (github.com/kalil0321/ats-scrapers), mapped
 * onto this shape.
 */

export type EmploymentType =
  | "FULL_TIME"
  | "PART_TIME"
  | "CONTRACT"
  | "INTERN"
  | "TEMPORARY"

export type ReplicaJob = {
  /** Stable ATS-assigned id, namespaced `${ats}:${id}` to match the harvester. */
  externalId: string
  title: string
  applyUrl: string
  description?: string
  location?: string
  /** ISO-8601 string. */
  postedAt?: string
  /** "remote" | "hybrid" | "onsite" — best-effort. */
  workMode?: string
  employmentType?: EmploymentType
  salaryMin?: number
  salaryMax?: number
  salaryCurrency?: string
}

export type ScrapeResult = {
  ats: string
  slug: string
  jobs: ReplicaJob[]
  /** Wall-clock of the whole scrape (list + any detail fan-out). */
  latencyMs: number
  /** Set when the scrape failed outright (company-not-found, network, etc). */
  error?: string
  /** True when the ATS reported the board does not exist (404). */
  notFound?: boolean
}

export class CompanyNotFoundError extends Error {}
export class ScraperError extends Error {}
