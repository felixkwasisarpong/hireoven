/**
 * Scout Company Intelligence Layer — Types V1
 *
 * All intel fields are derived from real DB data (CompanyHiringHealth,
 * CompanyImmigrationProfileSummary, Job rows). Nothing is fabricated.
 * Every claim is evidence-backed and phrased cautiously.
 */

export type CompanyIntel = {
  companyId: string

  hiringVelocity?: {
    trend:     "rising" | "stable" | "slowing" | "unknown"
    evidence?: string[]
  }

  sponsorshipSignals?: {
    h1bHistory?:           boolean
    lcaHistory?:           boolean
    likelySponsorsRoles?:  string[]
    /** 0–1, from company.sponsorship_confidence */
    confidence?:           number
  }

  responseSignals?: {
    likelihood: "high" | "medium" | "low" | "unknown"
    reasons?:   string[]
  }

  interviewSignals?: {
    processLength?: "short" | "medium" | "long" | "unknown"
    commonStages?:  string[]
  }

  hiringFreshness?: {
    freshness: "active" | "mixed" | "stale" | "unknown"
    evidence?: string[]
  }

  marketPosition?: {
    category?: string
    sector?:   string
    size?:     string
  }
}

/** Compact summary surfaced in UI labels and Scout chat */
export type CompanyIntelSummary = {
  companyId:              string
  companyName:            string
  sponsorshipLabel?:      string  // e.g. "Historically sponsors H-1B"
  hiringLabel?:           string  // e.g. "Hiring actively"
  freshnessLabel?:        string  // e.g. "Posting appears stale"
  competitionLabel?:      string  // e.g. "Likely high competition"
  activeOpeningsCount?:   number
  /** Short prose bullet list for Scout conversational surfacing */
  conversationalSignals:  string[]
}
