import type { QueryResult, QueryResultRow } from "pg"
import type {
  JobMatchScore,
  MatchScoreBreakdown,
  Profile,
  Resume,
  WorkAuthorization,
} from "@/types"
import type {
  ApplicationXRayInput,
  CapabilitySignalInput,
  EvidenceSignalInput,
  HiringRealitySignalInput,
  PositioningSignalInput,
} from "../inputs"
import type {
  ActionableAccessRoute,
  ApplicationXRay,
  ReferralAdvantageAdvisory,
  XRayDataGap,
  XRaySourceFact,
} from "../types"

export type XRayQueryable = {
  query<T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<T>>
}

export type JsonRecord = Record<string, unknown>

export type XRayCompanyRow = JsonRecord & {
  id?: string | null
  name?: string | null
  domain?: string | null
  ats_type?: string | null
  direct_ats_provider?: string | null
  direct_ats_identifier?: string | null
  last_crawled_at?: string | null
  median_days_open?: number | null
  time_to_fill_sample?: number | null
  sponsors_h1b?: boolean | null
  h1b_sponsor_count_1yr?: number | null
  h1b_sponsor_count_3yr?: number | null
  is_e_verify?: boolean | null
  e_verify_status?: string | null
  e_verify_synced_at?: string | null
  updated_at?: string | null
}

export type XRayJobRow = {
  id: string
  company_id: string | null
  duplicate_of_id: string | null
  title: string
  normalized_title: string | null
  description: string | null
  apply_url: string | null
  content_hash: string | null
  raw_data: JsonRecord | null
  skills: string[] | null
  source_ats: string | null
  source_ats_slug: string | null
  external_id: string | null
  is_active: boolean | null
  publication_status: string | null
  closed_at: string | null
  first_detected_at: string | null
  last_seen_at: string | null
  posted_at?: string | null
  is_remote: boolean | null
  location: string | null
  employment_type: string | null
  seniority_level: string | null
  sponsors_h1b: boolean | null
  requires_authorization: boolean | null
  visa_language_detected: string | null
  h1b_prediction?: JsonRecord | null
  h1b_prediction_at?: string | null
  company: XRayCompanyRow | null
}

export type XRayGhostScoreRow = {
  risk_score: number | null
  risk_level: string | null
  signals: unknown
  repost_count: number | null
  url_status: string | null
  has_hiring_freeze: boolean | null
  last_scanned_at: string | null
}

export type XRayHealthScoreRow = {
  total_score: number | null
  verdict: string | null
  signals: unknown
  events: unknown
  last_computed_at: string | null
}

export type XRayRejectionPatternRow = {
  total_submissions: number | null
  referral_screen_rate: string | number | null
  cold_apply_screen_rate: string | number | null
  last_computed_at: string | null
}

export type XRayApplicationRow = {
  id: string
  status: string | null
  resume_id: string | null
  applied_at: string | null
  updated_at: string | null
}

export type XRayCredentialDeclarationRow = {
  id: string
  user_id: string
  credential_key: string
  credential_label: string
  held: boolean
  expected_at: string | null
  note: string | null
  source: "prompt" | "profile" | "import"
  declared_at: string
  updated_at: string
}

export type XRayResumeRow = Resume
export type XRayProfileRow = Profile & { default_resume_id?: string | null }
export type XRayAutofillRow = {
  id: string
  user_id: string
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  city: string | null
  state: string | null
  country: string | null
  linkedin_url: string | null
  github_url: string | null
  portfolio_url: string | null
  website_url: string | null
  work_authorization: WorkAuthorization | null
  requires_sponsorship: boolean | null
  authorized_to_work: boolean | null
  sponsorship_statement: string | null
  years_of_experience: number | null
  highest_degree: string | null
  field_of_study: string | null
  university: string | null
  graduation_year: number | null
  created_at: string
  updated_at: string
}

export type XRayScoreRow = JobMatchScore & {
  resume_updated_at: string
  score_breakdown?: MatchScoreBreakdown | null
}

export type XRayLoadedData = {
  now: string
  userId: string
  requestedJobId: string
  selectedJob: XRayJobRow | null
  requestedJob: XRayJobRow | null
  jobRows: XRayJobRow[]
  profile: XRayProfileRow | null
  defaultResumeId: string | null
  autofillProfile: XRayAutofillRow | null
  resume: XRayResumeRow | null
  explicitResumeId: string | null
  matchScore: XRayScoreRow | null
  computedMatchBreakdown: MatchScoreBreakdown | null
  matchScoreFresh: boolean | "missing" | "stale" | "unavailable"
  ghostScore: XRayGhostScoreRow | null
  healthScore: XRayHealthScoreRow | null
  rejectionPattern: XRayRejectionPatternRow | null
  applications: XRayApplicationRow[]
  credentialDeclarations: XRayCredentialDeclarationRow[]
  accessRoutes: ActionableAccessRoute[]
  sourceFacts: XRaySourceFact[]
  dataGaps: XRayDataGap[]
  optionalWarnings: string[]
}

export type XRayMappedSignals = {
  input: ApplicationXRayInput
  capability: CapabilitySignalInput
  evidence: EvidenceSignalInput
  positioning: PositioningSignalInput
  hiringReality: HiringRealitySignalInput
  referralAdvisory: ReferralAdvantageAdvisory | null
}

export type ApplicationXRayResponsePayload = {
  xray: ApplicationXRay
  meta: {
    requestedJobId: string
    evaluatedJobId: string | null
    resumeId: string | null
    computedAt: string
    schemaVersion: string
  }
}
