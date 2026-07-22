/**
 * Pure (client-safe) types + helpers for the landing-page job search. No pg /
 * SQL imports here so the client search island can import the sponsorship
 * classifier and the API→LandingJob mapper without dragging server code into
 * the browser bundle.
 */

import { freshnessLabel } from "@/lib/jobs/format"

export type Sponsorship = "filed" | "likely" | "none"

export interface LandingJob {
  id: string
  title: string
  company: string | null
  companyDomain: string | null
  companyLogoUrl: string | null
  location: string | null
  isRemote: boolean
  salaryLabel: string | null
  fresh: string
  sponsorship: Sponsorship
  /** Certified petitions in the last 12 months, when known. */
  petitions1yr: number | null
}

/**
 * Classify an employer's sponsorship signal. Shared by the server render and the
 * client mapper so both apply identical thresholds.
 * - filed : real certified petitions on record (evidence-backed)
 * - likely: no filings found but the listing's visa-language score is high
 * - none  : no signal
 */
export function classifySponsorship(input: {
  jobSponsorsH1b?: boolean | null
  companySponsorsH1b?: boolean | null
  petitions1yr?: number | null
  sponsorshipScore?: number | null
}): Sponsorship {
  if ((input.petitions1yr ?? 0) > 0 || input.companySponsorsH1b === true || input.jobSponsorsH1b === true) {
    return "filed"
  }
  if ((input.sponsorshipScore ?? 0) > 60) return "likely"
  return "none"
}

/** Shape of a job as returned by GET /api/jobs (only the fields we read). */
export interface ApiJob {
  id: string
  title: string
  location: string | null
  is_remote: boolean | null
  first_detected_at: string | null
  sponsors_h1b: boolean | null
  sponsorship_score: number | null
  company: {
    name: string | null
    domain: string | null
    logo_url: string | null
    sponsors_h1b: boolean | null
    h1b_sponsor_count_1yr: number | null
  } | null
  card_view?: { salary_label?: string | null } | null
}

/** Map a /api/jobs result row to the LandingJob shape the UI renders. */
export function mapApiJobToLandingJob(j: ApiJob): LandingJob {
  const petitions1yr = j.company?.h1b_sponsor_count_1yr ?? null
  return {
    id: j.id,
    title: j.title,
    company: j.company?.name ?? null,
    companyDomain: j.company?.domain ?? null,
    companyLogoUrl: j.company?.logo_url ?? null,
    location: j.location,
    isRemote: Boolean(j.is_remote),
    salaryLabel: j.card_view?.salary_label ?? null,
    fresh: freshnessLabel(j.first_detected_at),
    sponsorship: classifySponsorship({
      jobSponsorsH1b: j.sponsors_h1b,
      companySponsorsH1b: j.company?.sponsors_h1b,
      petitions1yr,
      sponsorshipScore: j.sponsorship_score,
    }),
    petitions1yr,
  }
}
