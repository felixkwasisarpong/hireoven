/**
 * Application X-Ray — PROPOSED TypeScript contract.
 * Revision 2, final correction pass. Supersedes all earlier revisions.
 *
 * STATUS: design document. This file is not wired into the application and does
 * not modify `types/index.ts`. It is deliberately SELF-CONTAINED — it imports
 * nothing, so it compiles in isolation under `tsc --noEmit --strict`, and a
 * reviewer can read it without the rest of the repository. The handful of types
 * mirrored from `types/index.ts` are marked as such and must be kept in step if
 * this is ever promoted into the app.
 *
 * ─── Corrections applied in this pass ──────────────────────────────────────
 *
 *  C2  Generic no-sponsorship language no longer implies "current only".
 *      Without temporal wording it is SPONSORSHIP_SCOPE_AMBIGUOUS.
 *  C3  Authorization is expressed against the TARGET EMPLOYER, not as a
 *      candidate attribute: canWorkForTargetEmployerWithoutNewImmigrationAction.
 *  C4  A single futureActionType is replaced by an ordered
 *      futureEmployerActions[], each with its own status, source and gaps.
 *  C5  E-Verify participation is four-state; "not found in source" is not
 *      "not enrolled".
 *  C6  The duplicated NO_CURRENT_SPONSORSHIP mapping is dissolved by C2.
 *  C7  Unreadable résumé + unconfirmed requirement resolves to one information
 *      state carrying both unblock actions.
 *
 * ─── Invariants encoded structurally ──────────────────────────────────────
 *
 *  1. Every finding declares `basis` and `confidence`. There is no default.
 *  2. UNKNOWN / NOT_FOUND are first-class and never become negative facts.
 *  3. The five dimensions never read each other's raw scores.
 *  4. ATS screen fit is Positioning; career fit is Capability.
 *  5. Observed posting language is separate from probabilistic employer
 *     history. Only the former can produce a conflict band.
 *  6. No numeric interview/offer probability is representable.
 *  7. `decisionTrace` alone must be sufficient to replay the action.
 */

// ═══════════════════════════════════════════════════════════════════════════
// 0. Types mirrored from types/index.ts
//    Duplicated deliberately so this file stands alone. If promoted, delete
//    these and import from "@/types" instead.
// ═══════════════════════════════════════════════════════════════════════════

export type IntelligenceConfidence = "high" | "medium" | "low" | "unknown"
export type IntelligenceRiskLevel = "low" | "medium" | "high" | "unknown"

export type AtsType =
  | "greenhouse" | "lever" | "ashby" | "workday" | "icims" | "smartrecruiters"
  | "bamboohr" | "jobvite" | "taleo" | "successfactors" | "recruitee"
  | "teamtailor" | "workable" | "rippling" | "custom" | "unknown"

export type ApplicationStatus =
  | "saved" | "applied" | "phone_screen" | "interview"
  | "final_round" | "offer" | "rejected" | "withdrawn"

/** `profiles.visa_status`. Note it has 'citizen' and no 'tn_visa'. */
export type VisaStatus = "opt" | "stem_opt" | "h1b" | "citizen" | "green_card" | "other"

/** `autofill_profiles.work_authorization`. Note it has 'us_citizen' and
 *  'tn_visa' — the two vocabularies genuinely disagree and must be normalized. */
export type WorkAuthorization =
  | "us_citizen" | "green_card" | "h1b" | "opt" | "stem_opt"
  | "tn_visa" | "other" | "require_sponsorship"

export type CapExemptCategory =
  | "higher_education" | "nonprofit_research" | "government_research"
  | "affiliated_nonprofit" | "academic_medical_center" | "national_laboratory"
  | "unknown"

export type CapExemptSignal = {
  isLikelyCapExempt: boolean | null
  category: CapExemptCategory
  confidence: IntelligenceConfidence
  evidence: string[]
  summary: string | null
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Primitives
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The five terminal states. INSUFFICIENT_DATA is a deliberate addition to the
 * four required actions: without it, "we do not know" must masquerade as a
 * judgment. It maps to the existing ApplicationVerdict value "Unknown".
 */
export type XRayFinalAction =
  | "APPLY_NOW"
  | "STRENGTHEN_FIRST"
  | "FIND_ACCESS"
  | "SKIP"
  | "INSUFFICIENT_DATA"

export type XRayConfidence = IntelligenceConfidence

/**
 * What kind of statement a finding is; governs the verbs the UI may use.
 * There is deliberately no `recommendation` member — that is the circularity
 * guard, and it is enforced by the type rather than by review.
 */
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
  /** Literal source span. REQUIRED when this fact backs a
   *  PostingAuthorizationRequirement or a MANDATORY_EXPLICIT requirement. */
  excerpt?: string | null
  observedAt: string | null
  computedAt: string | null
  /** REQUIRED when basis === "prediction". A prediction without a sample is
   *  dropped, not downgraded. */
  sampleSize?: number | null
  sampleWindow?: string | null
  explanation: string
  /** Dimensions permitted to consume this fact — the double-count guard. */
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
  /** Must explicitly rule out the "unknown became false" trap where the
   *  underlying column has a non-null default. */
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
  /** UNKNOWN is not `limiting`. */
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
  /** True when staleness widened the band toward uncertainty. Never widens
   *  toward the negative end. */
  staleInputsDowngraded: boolean
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. Stage A — canonical resolution (preprocessing, never selects an action)
// ═══════════════════════════════════════════════════════════════════════════

export type CanonicalResolutionOutcome =
  | "not_a_duplicate"
  | "resolved"
  | "unresolved_dangling"
  | "unresolved_chain_limit"
  | "unresolved_canonical_invalid"

export type CanonicalResolution = {
  requestedJobId: string
  /** The job every dimension was computed against. */
  evaluatedJobId: string | null
  outcome: CanonicalResolutionOutcome
  hops: number
  canonicalApplyUrl: string | null
  requestedApplyUrl: string | null
  applyUrlDiffers: boolean
  sourceFactIds: string[]
  /** Required whenever outcome !== "not_a_duplicate". */
  note: string | null
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. Requirements — presence, strength, acquirability
// ═══════════════════════════════════════════════════════════════════════════

/**
 * NOT_FOUND is a statement about a document; ABSENT_CONFIRMED is a statement
 * about a person. Only the second may drive a negative decision.
 */
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

/** `llm_only` caps strength at INFERRED, always. */
export type RequirementStrengthProvenance =
  | "deterministic_pattern"
  | "structured_ats_field"
  | "section_header_plus_pattern"
  | "llm_only"
  | "none"

/**
 * No credential catalog exists in this repository, so `credential_catalog` is
 * unreachable in v0 and `candidate_declared` is the only non-unknown source.
 * A model may never populate this.
 */
export type AcquirabilitySource = "candidate_declared" | "credential_catalog" | "unknown"

export type RequirementAcquirability = {
  source: AcquirabilitySource
  /** Only meaningful when source !== "unknown". Never model-estimated. */
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

export type CredentialSearchLocation =
  | "structured_field"
  | "raw_text"
  | "candidate_declaration"

export type EvaluatedRequirement = {
  id: string
  kind: RequirementKind
  label: string

  strength: RequirementStrength
  strengthProvenance: RequirementStrengthProvenance
  /** REQUIRED when strength is MANDATORY_EXPLICIT. */
  strengthExcerpt: string | null

  presence: RequirementPresence
  /** Set only when presence === "CONTRADICTED". */
  contradictionReliability: ContradictionReliability | null
  searchedIn: CredentialSearchLocation[]

  acquirability: RequirementAcquirability

  sourceFactIds: string[]
  confidence: XRayConfidence

  /**
   * The ONLY field the decision table reads for a requirement-based SKIP.
   * True requires ALL of: MANDATORY_EXPLICIT strength; provenance that is
   * neither llm_only nor none; presence ABSENT_CONFIRMED, or CONTRADICTED at
   * declaration_vs_structured_field reliability; and no candidate-declared
   * acquisition inside the opportunity window.
   * NOT_FOUND and UNKNOWN can never make this true.
   */
  supportsHardSkip: boolean
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. Hiring Reality
// ═══════════════════════════════════════════════════════════════════════════

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
  /** False for legacy_crawler rows, which deactivate without reliably setting
   *  closed_at or publication_status. */
  closedAtReliable: boolean

  firstDetectedAt: string | null
  ageDays: number | null

  lastSeenAt: string | null
  /** Requires lastSeenAt >= lastSeenEpochIso for harvester-path rows. */
  lastSeenAtTrustworthy: boolean
  lastSeenEpochIso: string | null
  ingestionPath: JobIngestionPath

  boardLastCheckedAt: string | null
  /** Caps the band at LIKELY_LIVE. Can never push toward LIKELY_CLOSED —
   *  not-checked is not evidence of closure. */
  boardCheckIsStale: boolean

  /** CAVEAT: the probe maps HTTP 401/403 to "dead", and 403 is the routine
   *  answer many ATS give a bot HEAD request. Inference, never fact. */
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
  /** NOT a repost count — the underlying query counts other ACTIVE
   *  similar-title jobs at the same company. Named honestly so no surface can
   *  print "reposted N times". */
  concurrentSimilarOpenings: number | null
  /** True until a durable posting-cycle history table exists. */
  repostHistoryUnavailable: true
  computedAt: string | null
  cacheAgeHours: number | null
}

export type EmployerHealthVerdict = "strong" | "healthy" | "caution" | "critical" | "unknown"

export type EmployerCapacitySignal = {
  healthVerdict: EmployerHealthVerdict
  /** The health computer uses neutral defaults for absent data, so a company
   *  with NO observations totals into "healthy". The verdict is usable only
   *  when sub-scores had real observations. */
  observedSubScoreCount: number
  healthUsable: boolean
  healthComputedAt: string | null

  hiringFreeze: {
    detected: boolean | null
    confidence: "confirmed" | "likely" | "possible" | null
    /** True when this freeze already moved the ghost band. */
    alreadyCountedInGhostRisk: boolean
  }

  medianDaysOpen: number | null
  timeToFillSample: number | null
}

export type HiringRealityAssessment = XRayDimension<HiringRealityBand> & {
  availability: JobAvailabilityEvidence
  ghostRisk: GhostRiskAssessment
  employerCapacity: EmployerCapacitySignal
  /** Forces UNCERTAIN rather than letting the louder score win. */
  conflictingSignals: Array<{ a: string; b: string; resolution: string }>
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. Capability
// ═══════════════════════════════════════════════════════════════════════════

export type CapabilityBand =
  | "EXCEEDS"
  | "MEETS"
  | "NEAR_MISS"
  | "STRETCH"
  | "MISMATCH"
  | "UNKNOWN"

export type CareerFitLabel = "ats_ready" | "tailor_resume" | "bridge_first" | "career_pivot"

/**
 * The closed list of things that may corroborate a capability mismatch.
 * Keyword coverage is deliberately absent, and so is anything sourced from
 * evidence absence.
 */
export type MismatchCorroboration =
  | "role_family_incompatible"
  | "severe_years_shortfall"
  | "career_fit_below_floor"
  | "mandatory_absent_confirmed"

export type CapabilityAssessment = XRayDimension<CapabilityBand> & {
  /** From careerFit ONLY. `overall_score` is forbidden here: it folds a
   *  sponsorship rank delta, which would double-count work authorization. */
  careerFitScore: number | null
  careerFitLabel: CareerFitLabel | null

  relevantYears: number | null
  totalYears: number | null
  /** Null when not stated. "Not stated" is not "zero required", and no
   *  shortfall may be computed against it. */
  requiredYears: number | null
  requiredYearsStated: boolean
  relevantYearsRatio: number | null

  roleFamily: string | null
  candidateRoleFamilies: string[]
  /** The classifier mis-fires on multidisciplinary roles. Never decisive
   *  alone. */
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

// ═══════════════════════════════════════════════════════════════════════════
// 6. Evidence Strength
// ═══════════════════════════════════════════════════════════════════════════

export type EvidenceBand = "STRONG" | "ADEQUATE" | "BURIED" | "THIN" | "UNREADABLE"

/** The evidence-side mirror of RequirementPresence. Exists so "we did not find
 *  it" can never be rendered or reasoned about as "they lack it". */
export type EvidenceAbsenceKind =
  | "NOT_FOUND_IN_READABLE_DATA"
  | "CANDIDATE_CONFIRMED_ABSENT"
  | "EXPLICIT_CONTRADICTION"
  | "UNREADABLE_DATA"

/** Mirrors TailorSkillSuggestion["status"] so the two never drift. */
export type EvidenceSupportStatus =
  | "present"
  | "missing_supported"
  | "missing_needs_confirmation"
  | "not_recommended"

export type EvidenceLocatedIn = "structured_fields" | "raw_text_only" | "not_found"

export type ResumeParseState = "pending" | "processing" | "complete" | "failed" | "absent"

export type EvidenceStrengthAssessment = XRayDimension<EvidenceBand> & {
  /** Always "inferred" in v0. There is no claim-level evidence table, so
   *  "verified" is not representable. */
  verificationLevel: "inferred"

  requirementSupport: Array<{
    requirement: string
    status: EvidenceSupportStatus
    /** Set for every non-`present` status. */
    absenceKind: EvidenceAbsenceKind | null
    /** A WORDING hint, not proof of the skill. */
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
    /** Null when requiredTermCount is 0 — a sparse JD must not read as 0% or
     *  100% coverage. */
    presentRatio: number | null
  }

  /** In raw_text, absent from structured fields. The burial signal. */
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

  /** Literal false, so changing it is a reviewable contract change. */
  mayEstablishCapabilityAbsence: false
}

// ═══════════════════════════════════════════════════════════════════════════
// 7. Eligibility — observational, target-employer-relative
// ═══════════════════════════════════════════════════════════════════════════

/** Observations about a posting relative to what a candidate told us. Never
 *  conclusions about legal standing, and never rendered as "eligible". */
export type EligibilityObservationBand =
  | "NO_EXPLICIT_CONFLICT_FOUND"
  | "EMPLOYER_ACTION_MAY_BE_NEEDED"
  | "NEEDS_CLARIFICATION"
  | "EXPLICIT_REQUIREMENT_CONFLICT"
  | "UNKNOWN"

/**
 * C2. What the posting language is actually about.
 *
 * SPONSORSHIP_SCOPE_AMBIGUOUS is the default for a bare no-sponsorship
 * statement. "We are unable to provide visa sponsorship for this position"
 * does NOT establish that only *current* sponsorship is barred — it is simply
 * silent on scope. Only explicit temporal wording ("currently", "at this
 * time", "now", "in the future", "now or in the future") moves a statement
 * into one of the scoped categories.
 */
export type PostingAuthorizationLanguageCategory =
  /** Bare no-sponsorship language with no temporal qualifier. */
  | "SPONSORSHIP_SCOPE_AMBIGUOUS"
  /** Explicitly scoped to now: "we cannot sponsor at this time". */
  | "NO_CURRENT_SPONSORSHIP"
  /** Explicitly scoped to later: "will not sponsor in the future". */
  | "NO_FUTURE_SPONSORSHIP"
  /** Explicitly both: "requires sponsorship now or in the future". */
  | "NO_CURRENT_OR_FUTURE_SPONSORSHIP"
  /** "unrestricted" work authorization, or a named visa exclusion list.
   *  A bare "must be authorized to work" is NOT this category. */
  | "UNRESTRICTED_AUTHORIZATION_REQUIRED"
  | "CITIZENSHIP_REQUIRED"
  | "CLEARANCE_REQUIRED"
  /** Wording exists but bars nobody, e.g. "must be authorized to work". */
  | "AMBIGUOUS_GENERAL"
  | "SPONSORSHIP_OFFERED"

export type TemporalScopeMarker =
  | "currently"
  | "at_this_time"
  | "now"
  | "in_the_future"
  | "now_or_in_the_future"
  | "none_present"

export type PostingAuthorizationRequirement = {
  category: PostingAuthorizationLanguageCategory
  /** Literal matched sentence. Non-optional: an uncitable requirement is
   *  invalid output and must be dropped. */
  excerpt: string
  sourceFactId: string
  confidence: XRayConfidence
  /** False when only an LLM extraction produced it, which can never reach
   *  EXPLICIT_REQUIREMENT_CONFLICT. */
  deterministicMatch: boolean
  /** Which temporal marker, if any, disambiguated the scope. `none_present`
   *  is what forces SPONSORSHIP_SCOPE_AMBIGUOUS. */
  temporalScope: TemporalScopeMarker
  /** Named visa categories in the excerpt; upgrades
   *  UNRESTRICTED_AUTHORIZATION_REQUIRED from inferred to explicit. */
  namesVisaCategories: string[]
}

/**
 * C3. Whether the candidate can begin work FOR THIS EMPLOYER without a new
 * immigration action. This is not "does the candidate hold some status".
 *
 *   citizen / green card        YES
 *   OPT EAD, role related       YES  (subject to the role-relation test)
 *   STEM OPT                    YES only if the target employer can satisfy
 *                                    the E-Verify and I-983 requirements
 *   H-1B employed elsewhere     NEEDS_EMPLOYER_ACTION — a transfer petition is
 *                                    required before work can begin here
 *   requires sponsorship        NO
 *   status unknown              UNKNOWN
 */
export type TargetEmployerWorkAuthorization =
  | "YES"
  | "NO"
  | "NEEDS_EMPLOYER_ACTION"
  | "UNKNOWN"

/** C4. Paths a candidate's situation may require. Initial OPT does NOT imply
 *  H-1B is next; STEM OPT availability depends on candidate data we may not
 *  have. */
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
  /** Days until the action becomes necessary, when derivable. */
  horizonDays: number | null
  /** What the horizon was computed from, e.g. "profiles.opt_end_date". Null
   *  when horizonDays is null. */
  horizonBasis: string | null
  /**
   * REQUIRED — this action must happen for employment to continue.
   * POSSIBLE  — one of several viable paths; not established as necessary.
   * UNKNOWN   — we cannot tell, typically for missing candidate data such as
   *             STEM-degree eligibility.
   */
  status: FutureEmployerActionStatus
  source: FutureEmployerActionSource
  confidence: XRayConfidence
  /** Ids of XRayDataGap entries that keep this from being resolved. */
  dataGapIds: string[]
  /** User-facing sentence, phrased about the employer's action, not the
   *  candidate's standing. */
  explanation: string
}

/**
 * C5. E-Verify participation. "Not found in an incomplete source" is NOT
 * "confirmed not enrolled", and only the latter is a substantive signal.
 */
export type EVerifyParticipation =
  | "CONFIRMED_PARTICIPATING"
  | "CONFIRMED_NOT_ENROLLED"
  | "NOT_FOUND_IN_SOURCE"
  | "UNKNOWN"

export type EVerifySignal = {
  participation: EVerifyParticipation
  /** Which dataset was consulted, and how complete it is known to be. Required
   *  whenever participation is NOT_FOUND_IN_SOURCE, so coverage is disclosed. */
  sourceName: string | null
  sourceCoverageNote: string | null
  observedAt: string | null
  confidence: XRayConfidence
}

export type CandidateAuthorizationTimeline = {
  /** C3. The target-employer question, not a candidate attribute. */
  canWorkForTargetEmployerWithoutNewImmigrationAction: TargetEmployerWorkAuthorization
  /** Why that value, in the candidate's terms. */
  targetEmployerAuthorizationExplanation: string

  declaredVisaStatus: VisaStatus | null
  declaredWorkAuthorization: WorkAuthorization | null
  /** e.g. profiles.opt_end_date. Null when unbounded OR unknown; the two are
   *  distinguished by the declared status fields. */
  authorizationEndDate: string | null

  /** C4. Ordered most-imminent first. Empty means none identified, which is
   *  only meaningful when the status fields are known. */
  futureEmployerActions: FutureEmployerAction[]

  readFrom: Array<
    "profiles.visa_status" | "autofill_profiles.work_authorization" | "candidate_declaration"
  >
  /** True when only schema defaults were available. Forces every field to the
   *  unknown branch. */
  derivedFromDefaultsOnly: boolean
}

/**
 * Probabilistic employer history. May support EMPLOYER_ACTION_MAY_BE_NEEDED
 * commentary. It may NEVER produce EXPLICIT_REQUIREMENT_CONFLICT and may NEVER
 * produce NO_EXPLICIT_CONFLICT_FOUND.
 */
export type SponsorshipHistorySignal = {
  /** Tri-state. The underlying column defaults to false, so false + zero
   *  counts + zero confidence is UNKNOWN, not "does not sponsor". */
  employerHasSponsored: boolean | "unknown"
  recentPetitionCount: number | null
  totalLcaCount: number | null
  roleFamilyLcaCount: number | null
  roleFamilyMatchMethod: "soc_code" | "soc_title" | "title_family" | "unknown"
  worksiteLcaCount: number | null
  dataAsOf: string | null
  dataStale: boolean

  capExempt: CapExemptSignal | null
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
  /** True when the candidate's data was known well enough to evaluate. */
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

  sponsorshipHistory: SponsorshipHistorySignal | null

  otherConstraints: Array<{
    kind: OtherConstraintKind
    statement: string
    sourceFactId: string
    candidateConflict: boolean | "unknown"
  }>

  /** Literal type so the renderer cannot omit the disclaimer. */
  disclaimerRequired: true
}

// ═══════════════════════════════════════════════════════════════════════════
// 8. Positioning
// ═══════════════════════════════════════════════════════════════════════════

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

  /** Only these may become actionable edits. */
  supportedMissing: string[]
  /** Display-only, always framed "only if true". */
  unsupportedMissing: string[]
  presentKeywords: string[]

  leadWith: string[]
  surfaceFromRawText: string[]
  closeGaps: string[]

  fieldContext: {
    targetFieldKey: string | null
    fieldFitScore: number | null
    /** False before the corpus refresh has run. Degrades to UNKNOWN, never to
     *  a zero score. */
    corpusAvailable: boolean
  } | null

  repairEstimate: {
    supportedEditCount: number
    estimatedMinutes: number | null
    requiresNewEvidence: boolean
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 9. Actionable access
// ═══════════════════════════════════════════════════════════════════════════

export type AccessRouteType =
  | "direct_connection"
  | "second_degree_connection"
  | "company_alumni"
  | "cohort_peer"
  | "employer_recruiter_contact"
  | "candidate_supplied_contact"

/** At least one concrete channel is mandatory — a name with no channel is not
 *  a route. */
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
  /** MANDATORY. A route without a reachable channel is invalid output. */
  channel: AccessRouteChannel
  relationshipContext: string
  /** One imperative sentence the candidate can act on today. */
  nextStep: string
  sourceFactIds: string[]
  observedAt: string | null
  freshnessDays: number | null
  /** Routes past their type's horizon are dropped, not downgraded. */
  stale: boolean
  confidence: XRayConfidence
}

/** Advisory only. Never gates an action, never creates a route. */
export type ReferralAdvantageAdvisory = {
  companyId: string
  normalizedTitle: string
  totalSubmissions: number
  referralScreenRate: number | null
  coldApplyScreenRate: number | null
  deltaPercentagePoints: number | null
  lastComputedAt: string | null
  /** False below the sample threshold or past the staleness horizon; then the
   *  advisory is dropped entirely, not shown at low confidence. */
  displayable: boolean
  gatesFinalAction: false
}

// ═══════════════════════════════════════════════════════════════════════════
// 10. Risks and recommended actions
// ═══════════════════════════════════════════════════════════════════════════

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
  /** Ordering only. Deliberately not a probability. */
  severity: RejectionRiskSeverity
  likelihoodBasis: XRayBasis
  statement: string
  dimension: XRayDimensionKey
  sourceFactIds: string[]
  confidence: XRayConfidence
  /** Required when derived from community data; below threshold the risk is
   *  dropped, not shown at low confidence. */
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
  /** C2. Ask the employer whether the sponsorship bar extends beyond today. */
  | "confirm_future_sponsorship_policy"
  /** C5. Ask the employer whether it participates in E-Verify. */
  | "confirm_everify_participation"
  /** C5. Ask the candidate whether STEM OPT is required for this role. */
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
  /** True for anything touching an unsupported term or a NOT_FOUND
   *  requirement. Such actions are never auto-applicable. */
  requiresCandidateConfirmation: boolean
  /** True when answering would change the decision — drives the prominent
   *  presentation and, at stage D, the INSUFFICIENT_DATA outcome. */
  isDecisionBlockingConfirmation: boolean
  /** Set only for contact_named_route. */
  routeId?: string | null
  sourceFactIds: string[]
  target?: { surface: string; params?: Record<string, string> } | null
}

// ═══════════════════════════════════════════════════════════════════════════
// 11. Decision trace
// ═══════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════
// 12. Root object
// ═══════════════════════════════════════════════════════════════════════════

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
  schemaVersion: "xray-2026-08-13.r2-final"
  computedAt: string
  /** Hash of evaluatedJobId, resumeId, resumeVersion, job content_hash,
   *  engineVersion and the fast-score cache epoch. */
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

  /** FIND_ACCESS is unreachable when this is empty. */
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

  /** Write-only compatibility shim. X-Ray must never read this back. */
  legacyVerdictProjection?: {
    verdict: LegacyVerdictLabel
    recommendation: LegacyVerdictRecommendation
    derivedFrom: "application_xray"
  } | null
}

// ═══════════════════════════════════════════════════════════════════════════
// 13. Internal-only (never serialized to a client)
// ═══════════════════════════════════════════════════════════════════════════

export type XRayInternalScores = {
  ghostRiskScore: number | null
  visaFitScore: number | null
  companyHealthTotal: number | null
  /** Feed ranking only. Contains a sponsorship delta and must never reach
   *  Capability. */
  matchOverallScore: number | null
  atsScreenScore: number | null
  careerFitScore: number | null
  fastScoreGatesTriggered: string[]
  llmVerdict: string | null
  llmApplyRecommendation: string | null
}

export type XRayOutcomeLink = {
  applicationId: string | null
  statusAtSnapshot: ApplicationStatus | null
  snapshotFrozenAt: string | null
  /** Outcome data is not decision-usable until a coverage audit passes. */
  outcomeDataUsable: false
}
