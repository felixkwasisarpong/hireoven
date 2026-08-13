export const APPLICATION_XRAY_SCHEMA_VERSION = "xray-2026-08-13.r3-core" as const
export const APPLICATION_XRAY_ENGINE_VERSION = "application-xray-core-2026-08-13.1" as const

export type XRayConfidence = "high" | "medium" | "low" | "unknown"
export type IntelligenceRiskLevel = "low" | "medium" | "high" | "unknown"

export type AtsType =
  | "greenhouse"
  | "lever"
  | "ashby"
  | "workday"
  | "icims"
  | "smartrecruiters"
  | "bamboohr"
  | "jobvite"
  | "taleo"
  | "successfactors"
  | "recruitee"
  | "teamtailor"
  | "workable"
  | "rippling"
  | "custom"
  | "unknown"

export type ApplicationStatus =
  | "saved"
  | "applied"
  | "phone_screen"
  | "interview"
  | "final_round"
  | "offer"
  | "rejected"
  | "withdrawn"

export type VisaStatus = "opt" | "stem_opt" | "h1b" | "citizen" | "green_card" | "other"

export type WorkAuthorization =
  | "us_citizen"
  | "green_card"
  | "h1b"
  | "opt"
  | "stem_opt"
  | "tn_visa"
  | "other"
  | "require_sponsorship"

export type XRayFinalAction =
  | "APPLY_NOW"
  | "STRENGTHEN_FIRST"
  | "FIND_ACCESS"
  | "SKIP"
  | "INSUFFICIENT_DATA"

export type XRayBasis = "fact" | "inference" | "prediction"

export type XRaySourceKind =
  | "job_row"
  | "job_description_text"
  | "job_normalization"
  | "ats_metadata"
  | "company_row"
  | "company_health"
  | "company_layoffs"
  | "crawl_signal"
  | "ghost_score_cache"
  | "url_probe"
  | "match_score_cache"
  | "resume_row"
  | "resume_parse"
  | "resume_raw_text"
  | "tailor_analysis"
  | "positioning_brief"
  | "candidate_profile"
  | "autofill_profile"
  | "candidate_declaration"
  | "credential_catalog"
  | "networking_contacts"
  | "everify_source"
  | "lca_history"
  | "h1b_prediction"
  | "rejection_reports"
  | "application_history"
  | "timing_signals"
  | "llm_extraction"
  | "system_default"

export type XRayDimensionKey =
  | "hiringReality"
  | "capability"
  | "evidence"
  | "eligibility"
  | "positioning"

export type XRaySourceFact = {
  id: string
  kind: XRaySourceKind
  basis: XRayBasis
  confidence: XRayConfidence
  key: string
  value: string | number | boolean | null
  excerpt?: string | null
  observedAt: string | null
  computedAt: string | null
  sampleSize?: number | null
  sampleWindow?: string | null
  explanation: string
  usableBy: XRayDimensionKey[]
  caveat?: string | null
}

export type XRayGapSeverity = "dimension_blocking" | "decision_relevant" | "cosmetic"

export type XRayDataGap = {
  id: string
  dimension: XRayDimensionKey | "overall"
  severity: XRayGapSeverity
  label: string
  missingField: string
  whyNotDefaulted: string
  resolution?: {
    actor: "candidate" | "hireoven" | "employer"
    step: string
  } | null
}

export type XRayFinding = {
  id: string
  statement: string
  basis: XRayBasis
  confidence: XRayConfidence
  impact: "supporting" | "limiting" | "neutral" | "unknown"
  sourceFactIds: string[]
  explanation: string
  dataGapIds?: string[]
}

export type XRayDimension<TBand extends string> = {
  band: TBand
  confidence: XRayConfidence
  headline: string
  findings: XRayFinding[]
  dataGaps: XRayDataGap[]
  oldestInputObservedAt: string | null
  computedAt: string
  staleInputsDowngraded: boolean
}

export type CanonicalResolutionOutcome =
  | "not_a_duplicate"
  | "resolved"
  | "unresolved_dangling"
  | "unresolved_chain_limit"
  | "unresolved_canonical_invalid"

export type CanonicalResolution = {
  requestedJobId: string
  evaluatedJobId: string | null
  outcome: CanonicalResolutionOutcome
  hops: number
  canonicalApplyUrl: string | null
  requestedApplyUrl: string | null
  applyUrlDiffers: boolean
  sourceFactIds: string[]
  note: string | null
}

export type RequirementPresence =
  | "PRESENT"
  | "ABSENT_CONFIRMED"
  | "NOT_FOUND"
  | "CONTRADICTED"
  | "UNKNOWN"

export type ContradictionReliability =
  | "declaration_vs_structured_field"
  | "declaration_vs_free_text"
  | "free_text_internal"

export type RequirementStrength =
  | "MANDATORY_EXPLICIT"
  | "PREFERRED_EXPLICIT"
  | "INFERRED"
  | "UNKNOWN"

export type RequirementStrengthProvenance =
  | "deterministic_pattern"
  | "structured_ats_field"
  | "section_header_plus_pattern"
  | "llm_only"
  | "none"

export type AcquirabilitySource = "candidate_declared" | "credential_catalog" | "unknown"

export type RequirementAcquirability = {
  source: AcquirabilitySource
  estimatedDays: number | null
  candidateNote: string | null
  sourceFactIds: string[]
}

export type RequirementKind =
  | "certification"
  | "license"
  | "degree"
  | "years_of_experience"
  | "clearance"
  | "skill"
  | "language"
  | "other"

export type CredentialSearchLocation = "structured_field" | "raw_text" | "candidate_declaration"

export type EvaluatedRequirement = {
  id: string
  kind: RequirementKind
  label: string
  strength: RequirementStrength
  strengthProvenance: RequirementStrengthProvenance
  strengthExcerpt: string | null
  presence: RequirementPresence
  contradictionReliability: ContradictionReliability | null
  searchedIn: CredentialSearchLocation[]
  acquirability: RequirementAcquirability
  sourceFactIds: string[]
  confidence: XRayConfidence
  supportsHardSkip: boolean
}

export type HiringRealityBand =
  | "LIVE"
  | "LIKELY_LIVE"
  | "UNCERTAIN"
  | "LIKELY_CLOSED"
  | "CLOSED"
  | "UNKNOWN"

export type JobIngestionPath = "harvester" | "legacy_crawler" | "aggregator" | "unknown"
export type ApplyUrlProbeStatus = "ok" | "dead" | "redirect" | "unknown"

export type JobAvailabilityEvidence = {
  isActive: boolean | null
  publicationStatus: string | null
  closedAt: string | null
  closedAtReliable: boolean
  firstDetectedAt: string | null
  ageDays: number | null
  lastSeenAt: string | null
  lastSeenAtTrustworthy: boolean
  lastSeenEpochIso: string | null
  ingestionPath: JobIngestionPath
  boardLastCheckedAt: string | null
  boardCheckIsStale: boolean
  applyUrlStatus: ApplyUrlProbeStatus
  applyUrlProbedAt: string | null
}

export type GhostRiskContributingSignal =
  | "age"
  | "apply_url"
  | "similar_active_postings"
  | "location_spread"
  | "description_quality"
  | "salary_disclosure"
  | "link_source"
  | "ats_reliability"
  | "hiring_freeze"

export type GhostRiskAssessment = {
  band: IntelligenceRiskLevel
  contributingSignals: GhostRiskContributingSignal[]
  concurrentSimilarOpenings: number | null
  repostHistoryUnavailable: true
  computedAt: string | null
  cacheAgeHours: number | null
}

export type EmployerHealthVerdict = "strong" | "healthy" | "caution" | "critical" | "unknown"

export type EmployerCapacitySignal = {
  healthVerdict: EmployerHealthVerdict
  observedSubScoreCount: number
  healthUsable: boolean
  healthComputedAt: string | null
  hiringFreeze: {
    detected: boolean | null
    confidence: "confirmed" | "likely" | "possible" | null
    alreadyCountedInGhostRisk: boolean
  }
  medianDaysOpen: number | null
  timeToFillSample: number | null
}

export type HiringRealityAssessment = XRayDimension<HiringRealityBand> & {
  availability: JobAvailabilityEvidence
  ghostRisk: GhostRiskAssessment
  employerCapacity: EmployerCapacitySignal
  conflictingSignals: Array<{ a: string; b: string; resolution: string }>
}

export type CapabilityBand =
  | "EXCEEDS"
  | "MEETS"
  | "NEAR_MISS"
  | "STRETCH"
  | "MISMATCH"
  | "UNKNOWN"

export type CareerFitLabel = "ats_ready" | "tailor_resume" | "bridge_first" | "career_pivot"

export type MismatchCorroboration =
  | "role_family_incompatible"
  | "severe_years_shortfall"
  | "career_fit_below_floor"
  | "mandatory_absent_confirmed"

export type CapabilityAssessment = XRayDimension<CapabilityBand> & {
  careerFitScore: number | null
  careerFitLabel: CareerFitLabel | null
  relevantYears: number | null
  totalYears: number | null
  requiredYears: number | null
  requiredYearsStated: boolean
  relevantYearsRatio: number | null
  roleFamily: string | null
  candidateRoleFamilies: string[]
  roleFamilyCompatible: boolean | "unknown"
  requirements: EvaluatedRequirement[]
  mismatchCorroborationCount: number
  mismatchCorroborations: MismatchCorroboration[]
  overqualification: {
    detected: boolean
    seniorityGap: number | null
    note: string | null
  }
}

export type EvidenceBand = "STRONG" | "ADEQUATE" | "BURIED" | "THIN" | "UNREADABLE"

export type EvidenceAbsenceKind =
  | "NOT_FOUND_IN_READABLE_DATA"
  | "CANDIDATE_CONFIRMED_ABSENT"
  | "EXPLICIT_CONTRADICTION"
  | "UNREADABLE_DATA"

export type EvidenceSupportStatus =
  | "present"
  | "missing_supported"
  | "missing_needs_confirmation"
  | "not_recommended"

export type EvidenceLocatedIn = "structured_fields" | "raw_text_only" | "not_found"
export type ResumeParseState = "pending" | "processing" | "complete" | "failed" | "absent"

export type EvidenceStrengthAssessment = XRayDimension<EvidenceBand> & {
  verificationLevel: "inferred"
  requirementSupport: Array<{
    requirement: string
    status: EvidenceSupportStatus
    absenceKind: EvidenceAbsenceKind | null
    supportingContext: string | null
    locatedIn: EvidenceLocatedIn
    sourceFactIds: string[]
  }>
  coverage: {
    requiredTermCount: number
    presentCount: number
    supportedCount: number
    notFoundCount: number
    confirmedAbsentCount: number
    presentRatio: number | null
  }
  buriedEvidence: string[]
  legibility: {
    parseStatus: ResumeParseState
    parseError: string | null
    datedRoleCount: number
    hasRawText: boolean
    blocksAssessment: boolean
  }
  consistencyNotes: Array<{
    observation: string
    resumeSpanA: string
    resumeSpanB: string
    confidence: XRayConfidence
  }>
  mayEstablishCapabilityAbsence: false
}

export type EligibilityObservationBand =
  | "NO_EXPLICIT_CONFLICT_FOUND"
  | "EMPLOYER_ACTION_MAY_BE_NEEDED"
  | "NEEDS_CLARIFICATION"
  | "EXPLICIT_REQUIREMENT_CONFLICT"
  | "UNKNOWN"

export type PostingAuthorizationLanguageCategory =
  | "SPONSORSHIP_SCOPE_AMBIGUOUS"
  | "NO_CURRENT_SPONSORSHIP"
  | "NO_FUTURE_SPONSORSHIP"
  | "NO_CURRENT_OR_FUTURE_SPONSORSHIP"
  | "UNRESTRICTED_AUTHORIZATION_REQUIRED"
  | "CITIZENSHIP_REQUIRED"
  | "CLEARANCE_REQUIRED"
  | "AMBIGUOUS_GENERAL"
  | "SPONSORSHIP_OFFERED"

export type TemporalScopeMarker =
  | "start_employment"
  | "initial_work_authorization"
  | "in_the_future"
  | "now_or_in_the_future"
  | "none_present"

export type PostingAuthorizationRequirement = {
  category: PostingAuthorizationLanguageCategory
  excerpt: string
  sourceFactId: string
  confidence: XRayConfidence
  deterministicMatch: boolean
  temporalScope: TemporalScopeMarker
  namesVisaCategories: string[]
}

export type TargetEmployerWorkAuthorization =
  | "YES"
  | "NO"
  | "NEEDS_EMPLOYER_ACTION"
  | "UNKNOWN"

export type FutureEmployerActionType =
  | "STEM_OPT_EVERIFY_PARTICIPATION"
  | "STEM_OPT_I983"
  | "H1B_PETITION"
  | "H1B_TRANSFER"
  | "OTHER"
  | "UNKNOWN"

export type FutureEmployerActionStatus = "REQUIRED" | "POSSIBLE" | "UNKNOWN"

export type FutureEmployerActionSource =
  | "candidate_declaration"
  | "candidate_profile"
  | "posting_text"
  | "employer_record"
  | "everify_source"
  | "derived_from_status"
  | "unknown"

export type FutureEmployerAction = {
  type: FutureEmployerActionType
  horizonDays: number | null
  horizonBasis: string | null
  status: FutureEmployerActionStatus
  source: FutureEmployerActionSource
  confidence: XRayConfidence
  dataGapIds: string[]
  explanation: string
}

export type EVerifyParticipation =
  | "CONFIRMED_PARTICIPATING"
  | "CONFIRMED_NOT_ENROLLED"
  | "NOT_FOUND_IN_SOURCE"
  | "UNKNOWN"

export type EVerifySignal = {
  participation: EVerifyParticipation
  sourceName: string | null
  sourceCoverageNote: string | null
  observedAt: string | null
  confidence: XRayConfidence
}

export type CandidateAuthorizationTimeline = {
  canWorkForTargetEmployerWithoutNewImmigrationAction: TargetEmployerWorkAuthorization
  targetEmployerAuthorizationExplanation: string
  declaredVisaStatus: VisaStatus | null
  declaredWorkAuthorization: WorkAuthorization | null
  authorizationEndDate: string | null
  futureEmployerActions: FutureEmployerAction[]
  readFrom: Array<
    "profiles.visa_status" | "autofill_profiles.work_authorization" | "candidate_declaration"
  >
  derivedFromDefaultsOnly: boolean
  currentAuthorizationType?: "citizen" | "green_card" | "temporary_status" | "unknown"
}

export type EmployerActionFeasibilityStatus =
  | "AVAILABLE"
  | "REFUSED_CONFIRMED"
  | "NOT_FOUND"
  | "UNKNOWN"

export type EmployerActionFeasibility = {
  actionType: FutureEmployerActionType
  status: EmployerActionFeasibilityStatus
  employerStatementExcerpt: string | null
  candidateRequiresAction: boolean | "unknown"
  sourceFactIds: string[]
  confidence: XRayConfidence
}

export type SponsorshipHistorySignal = {
  employerHasSponsored: boolean | "unknown"
  recentPetitionCount: number | null
  totalLcaCount: number | null
  roleFamilyLcaCount: number | null
  roleFamilyMatchMethod: "soc_code" | "soc_title" | "title_family" | "unknown"
  worksiteLcaCount: number | null
  dataAsOf: string | null
  dataStale: boolean
  eVerify: EVerifySignal
  notARolePromise: true
}

export type AuthorizationConflictOutcome =
  | "conflict_now"
  | "conflict_future"
  | "no_conflict"
  | "needs_clarification"
  | "unknown"

export type AuthorizationConflictEvaluation = {
  requirement: PostingAuthorizationRequirement
  outcome: AuthorizationConflictOutcome
  explanation: string
  confidence: XRayConfidence
  candidateDataSufficient: boolean
}

export type OtherConstraintKind =
  | "location"
  | "work_mode"
  | "employment_type"
  | "licensure"
  | "other"

export type EligibilityAssessment = XRayDimension<EligibilityObservationBand> & {
  candidate: CandidateAuthorizationTimeline
  postingRequirements: PostingAuthorizationRequirement[]
  descriptionWasReadable: boolean
  conflicts: AuthorizationConflictEvaluation[]
  employerActionFeasibility: EmployerActionFeasibility[]
  sponsorshipHistory: SponsorshipHistorySignal | null
  otherConstraints: Array<{
    kind: OtherConstraintKind
    statement: string
    sourceFactId: string
    candidateConflict: boolean | "unknown"
  }>
  disclaimerRequired: true
}

export type PositioningBand = "ALIGNED" | "TUNABLE" | "MISALIGNED" | "UNKNOWN"

export type PositioningAssessment = XRayDimension<PositioningBand> & {
  atsScreenScore: number | null
  atsReadabilityScore: number | null
  targetAts: AtsType | null
  atsProfileApplied: string | null
  titleAlignment: {
    resumeTitle: string | null
    jobTitle: string
    mirrorsJobTitle: boolean | "unknown"
  }
  supportedMissing: string[]
  unsupportedMissing: string[]
  presentKeywords: string[]
  leadWith: string[]
  surfaceFromRawText: string[]
  closeGaps: string[]
  fieldContext: {
    targetFieldKey: string | null
    fieldFitScore: number | null
    corpusAvailable: boolean
  } | null
  repairEstimate: {
    supportedEditCount: number
    estimatedMinutes: number | null
    requiresNewEvidence: boolean
  }
}

export type AccessRouteType =
  | "direct_connection"
  | "second_degree_connection"
  | "company_alumni"
  | "cohort_peer"
  | "employer_recruiter_contact"
  | "candidate_supplied_contact"

export type AccessRouteChannel =
  | { kind: "linkedin_profile"; url: string }
  | { kind: "email"; address: string }
  | { kind: "internal_referral_form"; url: string }
  | { kind: "cohort_thread"; cohortId: string }

export type ActionableAccessRoute = {
  id: string
  routeType: AccessRouteType
  personName: string | null
  personRole: string | null
  personTeam: string | null
  channel: AccessRouteChannel
  relationshipContext: string
  nextStep: string
  sourceFactIds: string[]
  observedAt: string | null
  freshnessDays: number | null
  stale: boolean
  confidence: XRayConfidence
}

export type ReferralAdvantageAdvisory = {
  companyId: string
  normalizedTitle: string
  totalSubmissions: number
  referralScreenRate: number | null
  coldApplyScreenRate: number | null
  deltaPercentagePoints: number | null
  lastComputedAt: string | null
  displayable: boolean
  gatesFinalAction: false
}

export type RejectionRiskKind =
  | "screen_keyword_gap"
  | "years_shortfall"
  | "role_family_distance"
  | "mandatory_requirement_unconfirmed"
  | "mandatory_requirement_absent"
  | "seniority_mismatch"
  | "overqualification"
  | "authorization_language"
  | "future_authorization_policy_unknown"
  | "location_or_work_mode"
  | "posting_may_be_closed"
  | "employer_capacity"
  | "cold_apply_disadvantage"
  | "resume_legibility"

export type RejectionRiskSeverity = "critical" | "high" | "moderate" | "low"

export type RejectionRisk = {
  id: string
  kind: RejectionRiskKind
  severity: RejectionRiskSeverity
  likelihoodBasis: XRayBasis
  statement: string
  dimension: XRayDimensionKey
  sourceFactIds: string[]
  confidence: XRayConfidence
  sampleSize?: number | null
  addressableByActionId: string | null
}

export type RecommendedActionKind =
  | "verify_posting"
  | "apply_to_canonical_posting"
  | "surface_buried_evidence"
  | "rewrite_title_or_summary"
  | "add_supported_keywords"
  | "reframe_transferable_experience"
  | "confirm_requirement_status"
  | "acquire_missing_requirement"
  | "confirm_authorization_timeline"
  | "confirm_future_sponsorship_policy"
  | "confirm_everify_participation"
  | "confirm_stem_opt_requirement"
  | "contact_named_route"
  | "consider_referral_generally"
  | "complete_profile"
  | "upload_or_reparse_resume"
  | "choose_different_target"

export type RecommendedActionEffort = "minutes" | "hours" | "days" | "weeks_or_more"

export type RecommendedAction = {
  id: string
  kind: RecommendedActionKind
  label: string
  rationale: string
  addresses: XRayDimensionKey[]
  addressesRiskIds: string[]
  effort: RecommendedActionEffort
  doableNow: boolean
  requiresCandidateConfirmation: boolean
  isDecisionBlockingConfirmation: boolean
  routeId?: string | null
  sourceFactIds: string[]
  target?: { surface: string; params?: Record<string, string> } | null
}

export type XRayDecisionStage =
  | "A_canonical_resolution"
  | "B_definitive_closure"
  | "C_explicit_requirement_conflict"
  | "D_sufficiency"
  | "E_capability"
  | "F_evidence"
  | "G_positioning"
  | "H_actionable_access"
  | "I_apply"

export type XRayStageOutcome =
  | "passed_through"
  | "selected_action"
  | "skipped_insufficient_input"

export type XRayDecisionTrace = {
  engineVersion: string
  evaluated: Array<{
    stage: XRayDecisionStage
    firedRuleId: string | null
    outcome: XRayStageOutcome
    inputs: Record<string, string | number | boolean | null>
  }>
  selectedStage: XRayDecisionStage
  selectedRuleId: string
  suppressedRuleIds: string[]
  tieBreak: { competingRuleIds: string[]; resolvedBy: string } | null
}

export type XRaySummary = {
  finalAction: XRayFinalAction
  confidence: XRayConfidence
  bands: {
    hiringReality: HiringRealityBand
    capability: CapabilityBand
    evidence: EvidenceBand
    eligibility: EligibilityObservationBand
    positioning: PositioningBand
  }
  topRiskId: string | null
  resolvedFromDuplicate: boolean
  computedAt: string
}

export type LegacyVerdictLabel =
  | "Apply Today"
  | "Apply, But Customize Resume"
  | "Maybe"
  | "Skip"
  | "High Risk"
  | "Unknown"

export type LegacyVerdictRecommendation =
  | "apply_now"
  | "apply_with_tweaks"
  | "stretch_role"
  | "skip"
  | "watch"
  | "avoid"
  | "unknown"

export type ApplicationXRay = {
  schemaVersion: typeof APPLICATION_XRAY_SCHEMA_VERSION
  computedAt: string
  inputsHash: string
  canonical: CanonicalResolution
  evaluatedJobId: string | null
  requestedJobId: string
  companyId: string | null
  userId: string
  resumeId: string | null
  resumeVersion: number | null
  hiringReality: HiringRealityAssessment
  capability: CapabilityAssessment
  evidence: EvidenceStrengthAssessment
  eligibility: EligibilityAssessment
  positioning: PositioningAssessment
  accessRoutes: ActionableAccessRoute[]
  referralAdvisory: ReferralAdvantageAdvisory | null
  rejectionRisks: RejectionRisk[]
  actions: RecommendedAction[]
  finalAction: XRayFinalAction
  confidence: XRayConfidence
  headline: string
  decisionTrace: XRayDecisionTrace
  dataGaps: XRayDataGap[]
  sourceFacts: XRaySourceFact[]
  summary: XRaySummary
  legacyVerdictProjection?: {
    verdict: LegacyVerdictLabel
    recommendation: LegacyVerdictRecommendation
    derivedFrom: "application_xray"
  } | null
}
