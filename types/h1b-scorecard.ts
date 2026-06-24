export type Grade = "A+" | "A" | "B" | "C" | "D" | "F"

export type ScoreHue = "emerald" | "green" | "blue" | "amber" | "orange" | "red"

export interface ScoreBucket {
  grade: Grade
  label: string // "Top-Tier Sponsor"
  short: string // "Top-Tier"
  hue: ScoreHue
  description: string // one-sentence explanation
}

export interface ScorecardPayload {
  company: {
    id: string
    name: string
    domain: string | null
    logo_url: string | null
    industry: string | null
  }
  score: number // 0-100, = companies.sponsorship_confidence
  bucket: ScoreBucket
  metrics: {
    total_filings: number
    certified: number
    cert_rate: number
    latest_fy: number
    certified_latest_fy: number
    filed_latest_fy: number // total LCAs filed in the latest FY (denominator)
    // Multi-year USCIS approved-petition history (h1b_records), oldest → newest,
    // excluding the in-progress fiscal year. Up to 5 complete FYs.
    series: Array<{ year: number; approved: number }>
    top_states: string[]
    top_titles: string[]
  }
  flags: {
    is_staffing_firm: boolean
    is_consulting_firm: boolean
    has_high_denial_rate: boolean
  }
  rank: {
    overall: number | null
    cert_rate: number | null
    in_industry: number | null
    industry: string | null
  }
  refreshed_at: string
  scorecard_url: string
  profile_url: string
}
