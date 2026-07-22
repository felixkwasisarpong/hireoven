/**
 * Landing-page job search — the public "try it before signing up" feed.
 *
 * Shares the exact matching the public /api/jobs route uses (tokenized ILIKE
 * over title/company/location/skills, published + US/CA gates) so the
 * server-rendered first paint and the client's live search agree. The client
 * calls /api/jobs directly; this helper renders the initial default query.
 */

import type { Pool } from "pg"
import { sqlPublishedJob } from "@/lib/jobs/publication"
import { sqlJobLocatedInUsa } from "@/lib/jobs/usa-job-sql"
import { tokenizeJobSearchQuery, escapeLikePattern, buildJobSearchTokenSql } from "@/lib/jobs/search-sql"
import { formatSalaryLabel } from "@/lib/jobs/normalization/view-model"
import { freshnessLabel } from "@/lib/jobs/format"
import { classifySponsorship, type LandingJob } from "@/lib/jobs/landing-search-types"

export type { LandingJob, Sponsorship } from "@/lib/jobs/landing-search-types"

interface Row {
  id: string
  title: string
  location: string | null
  is_remote: boolean | null
  salary_min: number | null
  salary_max: number | null
  salary_currency: string | null
  first_detected_at: string | null
  sponsors_h1b: boolean | null
  sponsorship_score: number | null
  company: string | null
  domain: string | null
  logo_url: string | null
  company_sponsors: boolean | null
  h1b_sponsor_count_1yr: number | null
}

function toLandingJob(r: Row): LandingJob {
  return {
    id: r.id,
    title: r.title,
    company: r.company,
    companyDomain: r.domain,
    companyLogoUrl: r.logo_url,
    location: r.location,
    isRemote: Boolean(r.is_remote),
    salaryLabel: formatSalaryLabel(r.salary_min, r.salary_max, r.salary_currency),
    fresh: freshnessLabel(r.first_detected_at),
    sponsorship: classifySponsorship({
      jobSponsorsH1b: r.sponsors_h1b,
      companySponsorsH1b: r.company_sponsors,
      petitions1yr: r.h1b_sponsor_count_1yr,
      sponsorshipScore: r.sponsorship_score,
    }),
    petitions1yr: r.h1b_sponsor_count_1yr,
  }
}

/** Freshest published US/CA jobs matching `q` (or freshest overall when blank). */
export async function searchLandingJobs(pool: Pool, q: string, limit = 8): Promise<LandingJob[]> {
  const where: string[] = ["jobs.is_active = true", sqlPublishedJob("jobs"), sqlJobLocatedInUsa("jobs")]
  const values: Array<string | number> = []
  const add = (v: string | number) => {
    values.push(v)
    return `$${values.length}`
  }

  if (q.trim()) {
    for (const token of tokenizeJobSearchQuery(q)) {
      const p = add(`%${escapeLikePattern(token)}%`)
      where.push(buildJobSearchTokenSql({ patternParam: p, token }))
    }
  }

  const limitParam = add(limit)
  const { rows } = await pool.query<Row>(
    `SELECT jobs.id, jobs.title, jobs.location, jobs.is_remote,
            jobs.salary_min, jobs.salary_max, jobs.salary_currency, jobs.first_detected_at,
            jobs.sponsors_h1b, jobs.sponsorship_score,
            companies.name AS company, companies.domain, companies.logo_url,
            companies.sponsors_h1b AS company_sponsors, companies.h1b_sponsor_count_1yr
       FROM jobs
       LEFT JOIN companies ON companies.id = jobs.company_id
      WHERE ${where.join(" AND ")}
      ORDER BY jobs.first_detected_at DESC NULLS LAST
      LIMIT ${limitParam}`,
    values,
  )
  return rows.map(toLandingJob)
}
