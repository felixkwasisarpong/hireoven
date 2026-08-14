import type {
  ActionableAccessRoute,
  CandidateAuthorizationTimeline,
  EligibilityAssessment,
  EmployerActionFeasibility,
  EmployerCapacitySignal,
  EvaluatedRequirement,
  GhostRiskAssessment,
  JobAvailabilityEvidence,
  PositioningAssessment,
  PostingAuthorizationRequirement,
  ReferralAdvantageAdvisory,
  ResumeParseState,
  XRayConfidence,
  XRayDataGap,
  XRayFinding,
  XRaySourceFact,
} from "./types"

export type ApplicationXRayJobRecord = {
  id: string
  companyId: string | null
  duplicateOfId: string | null
  title: string
  applyUrl: string | null
  contentHash: string | null
  availability: JobAvailabilityEvidence
  descriptionReadable: boolean
  /** Raw posting text, used by the assessability check to look for duties and
   *  requirements. Never used to judge the candidate. */
  descriptionText?: string | null
  /** Requisition-like id, if the source supplied one. */
  externalId?: string | null
}

export type ApplicationXRayResumeInput = {
  id: string | null
  version: number | null
  parseStatus: ResumeParseState
  parseError: string | null
  hasRawText: boolean
  datedRoleCount: number
}

export type CapabilitySignalInput = {
  careerFitScore: number | null
  careerFitLabel: "ats_ready" | "tailor_resume" | "bridge_first" | "career_pivot" | null
  relevantYears: number | null
  totalYears: number | null
  requiredYears: number | null
  requiredYearsStated: boolean
  relevantYearsRatio: number | null
  roleFamily: string | null
  candidateRoleFamilies: string[]
  roleFamilyCompatible: boolean | "unknown"
  requirements: EvaluatedRequirement[]
  mismatchCorroborations: Array<
    "role_family_incompatible" | "severe_years_shortfall" | "career_fit_below_floor" | "mandatory_absent_confirmed"
  >
  overqualification?: {
    detected: boolean
    seniorityGap: number | null
    note: string | null
  }
  /**
   * True when a readable, parsed resume was supplied. Distinguishes
   * "the candidate gave us nothing" from "HireOven has not scored this pair
   * yet". Only the first is the candidate's to fix.
   */
  resumeReadable?: boolean
  /** Human-readable reason the posting's career track does or does not match
   *  the candidate's history. Surfaced so a lane mismatch is stated, not
   *  merely implied by a corroboration flag. */
  trackExplanation?: string | null
  confidence?: XRayConfidence
  findings?: XRayFinding[]
}

export type EvidenceSignalInput = {
  requirementSupport: Array<{
    requirement: string
    status: "present" | "missing_supported" | "missing_needs_confirmation" | "not_recommended"
    absenceKind:
      | "NOT_FOUND_IN_READABLE_DATA"
      | "CANDIDATE_CONFIRMED_ABSENT"
      | "EXPLICIT_CONTRADICTION"
      | "UNREADABLE_DATA"
      | null
    supportingContext: string | null
    locatedIn: "structured_fields" | "raw_text_only" | "not_found"
    sourceFactIds: string[]
  }>
  buriedEvidence: string[]
  consistencyNotes?: Array<{
    observation: string
    resumeSpanA: string
    resumeSpanB: string
    confidence: XRayConfidence
  }>
  confidence?: XRayConfidence
  findings?: XRayFinding[]
}

export type PositioningSignalInput = {
  atsScreenScore: number | null
  atsReadabilityScore: number | null
  targetAts: PositioningAssessment["targetAts"]
  atsProfileApplied: string | null
  resumeTitle: string | null
  supportedMissing: string[]
  unsupportedMissing: string[]
  presentKeywords: string[]
  leadWith: string[]
  surfaceFromRawText: string[]
  closeGaps: string[]
  fieldContext: PositioningAssessment["fieldContext"]
  repairEstimate: PositioningAssessment["repairEstimate"]
  /** True when the ATS screen score was actually computed. A null score
   *  because nothing scored it is not evidence of misalignment. */
  atsScreenScoreAvailable?: boolean
  confidence?: XRayConfidence
  findings?: XRayFinding[]
  bandHint?: PositioningAssessment["band"]
}

export type HiringRealitySignalInput = {
  ghostRisk: GhostRiskAssessment
  employerCapacity: EmployerCapacitySignal
  conflictingSignals?: Array<{ a: string; b: string; resolution: string }>
  confidence?: XRayConfidence
  findings?: XRayFinding[]
}

export type EligibilitySignalInput = {
  candidate: CandidateAuthorizationTimeline
  postingRequirements: PostingAuthorizationRequirement[]
  sponsorshipHistory: EligibilityAssessment["sponsorshipHistory"]
  otherConstraints: EligibilityAssessment["otherConstraints"]
  employerActionFeasibility: EmployerActionFeasibility[]
  confidence?: XRayConfidence
  findings?: XRayFinding[]
}

export type ApplicationXRayInput = {
  now: string
  requestedJobId: string
  userId: string
  resume: ApplicationXRayResumeInput | null
  jobRecords: ApplicationXRayJobRecord[]
  capability: CapabilitySignalInput
  evidence: EvidenceSignalInput
  positioning: PositioningSignalInput
  hiringReality: HiringRealitySignalInput
  eligibility: EligibilitySignalInput
  accessRoutes: ActionableAccessRoute[]
  referralAdvisory: ReferralAdvantageAdvisory | null
  sourceFacts?: XRaySourceFact[]
  dataGaps?: XRayDataGap[]
}
