/**
 * Application X-Ray — PROPOSED type contract (design document, not production).
 * Revision 2. Supersedes revision 1 in full.
 *
 * This file is a proposal. It does NOT modify `types/index.ts`. It is type-only
 * so it compiles under the repo's `tsc --noEmit` (tsconfig includes `**\/*.ts`)
 * without adding runtime surface area.
 *
 * ─── What changed in revision 2 ────────────────────────────────────────────
 *
 *  R2-1  Duplicate resolution moved OUT of the decision table and INTO
 *        preprocessing (`CanonicalResolution`). A duplicate can never itself
 *        return an action.
 *  R2-2  Boolean `candidateHas` replaced by `RequirementPresence`
 *        (PRESENT | ABSENT_CONFIRMED | NOT_FOUND | CONTRADICTED | UNKNOWN).
 *        Only ABSENT_CONFIRMED, or CONTRADICTED at high reliability, may
 *        support a requirement-based SKIP.
 *  R2-3  Requirement strength is tri-state + provenance-aware
 *        (`RequirementStrength` × `RequirementStrengthProvenance`). An LLM
 *        extraction alone can never establish MANDATORY_EXPLICIT.
 *  R2-4  Acquirability requires a source (`AcquirabilitySource`). No credential
 *        catalog exists in this repository, so v0 resolves to UNKNOWN unless
 *        the candidate declares it. An LLM may not estimate acquisition time.
 *  R2-5  `ActionableAccessRoute` replaces statistical referral gating. FIND_ACCESS
 *        fires only on a route with a named person or concrete channel.
 *        Referral-rate statistics are advisory only.
 *  R2-6  Eligibility bands are observational, never legal
 *        (`EligibilityObservationBand`).
 *  R2-7  Candidate work authorization is a TIMELINE
 *        (`CandidateAuthorizationTimeline`), and posting language is
 *        categorized (`PostingAuthorizationLanguageCategory`). "On OPT" no
 *        longer implies "needs sponsorship now".
 *  R2-8  Evidence separates not-found / confirmed-absent / contradicted /
 *        unreadable (`EvidenceAbsenceKind`), and evidence absence can never
 *        establish capability absence.
 *  R2-9  Precedence stages renamed to A–I to match the prose exactly.
 *
 * ─── Invariants encoded here ───────────────────────────────────────────────
 *
 *  1. Every finding declares `basis` and `confidence`. There is no default.
 *  2. `UNKNOWN` / `NOT_FOUND` are first-class and never become negative facts.
 *  3. Capability, Evidence, Eligibility, Positioning and Hiring Reality never
 *     read each other's raw scores.
 *  4. ATS screen fit lives in Positioning; career fit lives in Capability.
 *  5. Observed posting language is structurally separate from probabilistic
 *     employer history. Only the former can produce a conflict band.
 *  6. No numeric interview/offer probability exists anywhere in this contract.
 *  7. `decisionTrace` must be sufficient to replay the action from bands and
 *     gates alone, with no I/O and no model call.
 */

import type {
  ApplicationStatus,
  AtsType,
  CapExemptSignal,
  IntelligenceConfidence,
  IntelligenceRiskLevel,
  VisaStatus,
  WorkAuthorization,
} from "@/types"

// ═══════════════════════════════════════════════════════════════════════════
// 1. Primitives
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The five terminal states. `INSUFFICIENT_DATA` is a deliberate addition to the
 * four required actions: without it, "we do not know" must masquerade as a
 * judgment. It maps to the existing `ApplicationVerdict.verdict` value
 * `"Unknown"` for backwards compatibility.
 */
export type XRayFinalAction =
  | "APPLY_NOW"
  | "STRENGTHEN_FIRST"
  | "FIND_ACCESS"
  | "SKIP"
  | "INSUFFICIENT_DATA"

/** Structurally identical to `IntelligenceConfidence`, aliased so X-Ray reads
 *  standalone and a future divergence is a one-line change. */
export type XRayConfidence = IntelligenceConfidence // 'high' | 'medium' | 'low' | 'unknown'

/** What kind of statement a finding is. Governs the verbs the UI may use.
 *  `recommendation` deliberately does not appear on `XRaySourceFact` — that is
 *  the circularity guard: a recommendation can never become evidence. */
export type XRayBasis = "fact" | "inference" | "prediction"

/** Where a fact physically came from. Names the reader, not the topic. */
export type XRaySourceKind =
  | "job_row"                 // jobs.*
  | "job_description_text"    // literal span of jobs.description
  | "job_normalization"       // raw_data.normalized / structured_job / view
  | "ats_metadata"            // raw_data.raw from the adapter
  | "company_row"             // companies.*
  | "company_health"          // company_health_scores
  | "company_layoffs"         // company_layoff_summary / company_news_signals
  | "crawl_signal"            // crawl_logs, companies.last_crawled_at, freshness tiers
  | "ghost_score_cache"       // ghost_job_scores
  | "url_probe"               // probeApplyUrl — CAVEAT: maps 401/403 to "dead"
  | "match_score_cache"       // job_match_scores.score_breakdown
  | "resume_row"              // resumes.*
  | "resume_parse"            // parsed structures from parseResume
  | "resume_raw_text"         // resumes.raw_text
  | "tailor_analysis"         // buildLocalTailorAnalysis / resume_tailoring_analyses
  | "positioning_brief"       // buildPositioningBrief / field_skill_profiles
  | "candidate_profile"       // profiles.*
  | "autofill_profile"        // autofill_profiles.*
  | "candidate_declaration"   // an explicit answer the candidate gave X-Ray
  | "credential_catalog"      // a curated acquirability catalog — DOES NOT EXIST YET
  | "networking_contacts"     // lib/networking/job-contact-finder.ts
  | "lca_history"             // LCA / H1B tables
  | "h1b_prediction"          // predictForJob / predictH1BApproval
  | "rejection_reports"       // rejection_patterns — advisory only in v0
  | "application_history"     // job_applications (this user)
  | "timing_signals"          // application_timing_signals
  | "llm_extraction"          // model-extracted requirement or phrasing
  | "system_default"          // an engine constant, not observed data

export type XRayDimensionKey =
  | "hiringReality"
  | "capability"
  | "evidence"
  | "eligibility"
  | "positioning"

/**
 * One provenance record. Findings do not embed values; they point at these by
 * `id`, so an observation used by two dimensions is stored once and is
 * auditable for double-counting.
 */
export type XRaySourceFact = {
  id: string
  kind: XRaySourceKind
  basis: XRayBasis
  confidence: XRayConfidence

  /** Machine label, e.g. "job.is_active", "careerFit.relevantYears". */
  key: string
  /** Value as stored. `null` means observed-as-null, not "missing" — a missing
   *  input produces no fact at all, only an `XRayDataGap`. */
  value: string | number | boolean | null
  /** Literal source span when `kind` is a text reader. Never paraphrased.
   *  REQUIRED when this fact backs a `PostingAuthorizationRequirement` or a
   *  `MANDATORY_EXPLICIT` requirement. */
  excerpt?: string | null

  observedAt: string | null
  computedAt: string | null

  /** REQUIRED when `basis === "prediction"`. A prediction without a sample is
   *  dropped, not downgraded. */
  sampleSize?: number | null
  sampleWindow?: string | null

  explanation: string
  /** Dimensions permitted to consume this fact. The engine rejects a finding
   *  citing a fact outside its own dimension — the double-count guard. */
  usableBy: XRayDimensionKey[]

  /** Known reliability caveat, rendered on expand. */
  caveat?: string | null
}

export type XRayGapSeverity =
  /** Blocks a whole dimension → that dimension is UNKNOWN. */
  | "dimension_blocking"
  /** Would likely change the action if known. Caps overall confidence. */
  | "decision_relevant"
  /** Reduces detail only. */
  | "cosmetic"

export type XRayDataGap = {
  id: string
  dimension: XRayDimensionKey | "overall"
  severity: XRayGapSeverity
  label: string
  missingField: string
  /** Why we cannot substitute a default. Must explicitly rule out the
   *  "unknown became false" trap where the column has a non-null default. */
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
  /** Direction within the dimension. UNKNOWN is NOT `limiting`. */
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
  /** True when a staleness threshold widened the band toward uncertainty
   *  rather than trusting the stale input. Never widens toward the negative. */
  staleInputsDowngraded: boolean
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. Stage A — canonical resolution (PREPROCESSING, not a decision)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * R2-1. A duplicate row is resolved to its canonical job BEFORE any dimension
 * is computed. The entire X-Ray then runs against the canonical job. A
 * duplicate can never independently produce APPLY_NOW — it produces the
 * canonical job's answer, whatever that is (including SKIP).
 *
 * If the canonical row cannot be resolved (dangling `duplicate_of_id`, or the
 * canonical is itself hidden/invalid), the engine does NOT fall back to the
 * duplicate. It reports `unresolved` and Hiring Reality becomes UNKNOWN.
 */
export type CanonicalResolutionOutcome =
  | "not_a_duplicate"        // requestedJobId is canonical
  | "resolved"               // followed duplicate_of_id to a usable canonical row
  | "unresolved_dangling"    // duplicate_of_id points at a missing row
  | "unresolved_chain_limit" // duplicate chain exceeded the hop limit
  | "unresolved_canonical_invalid" // canonical is hidden_invalid / not readable

export type CanonicalResolution = {
  requestedJobId: string
  /** The job every dimension was actually computed against. Equals
   *  `requestedJobId` when `outcome === "not_a_duplicate"`. */
  evaluatedJobId: string | null
  outcome: CanonicalResolutionOutcome
  /** Hops followed through `jobs.duplicate_of_id`. Bounded (recommend 3). */
  hops: number
  /** Set when the apply URL the user should use differs from the one on the
   *  requested row — drives the `apply_to_canonical_posting` action. */
  canonicalApplyUrl: string | null
  requestedApplyUrl: string | null
  applyUrlDiffers: boolean
  sourceFactIds: string[]
  /** User-facing note, required whenever `outcome !== "not_a_duplicate"`. */
  note: string | null
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. Requirements — presence, strength, acquirability
// ═══════════════════════════════════════════════════════════════════════════

/**
 * R2-2. What we know about whether the candidate has a requirement.
 *
 * The critical distinction is NOT_FOUND vs ABSENT_CONFIRMED. Not finding a
 * credential on a resume is a statement about the DOCUMENT, not the person.
 * Résumés omit credentials constantly, and `resumes.skills.certifications`
 * is only as complete as the parse.
 */
export type RequirementPresence =
  /** Observed in the resume, a parsed field, or a candidate declaration. */
  | "PRESENT"
  /** The candidate explicitly told us they do not have it. */
  | "ABSENT_CONFIRMED"
  /** We looked and did not find it. NOT evidence of absence. */
  | "NOT_FOUND"
  /** Two candidate-sourced statements conflict (e.g. a declaration says absent
   *  while the resume lists it). Requires both spans. */
  | "CONTRADICTED"
  /** We could not look — resume unreadable, or the requirement is unparsed. */
  | "UNKNOWN"

/** How a CONTRADICTED state was reached, and whether it is decision-grade. */
export type ContradictionReliability =
  /** Candidate declaration vs. a parsed structured field. Decision-grade. */
  | "declaration_vs_structured_field"
  /** Candidate declaration vs. free-text mention only. Not decision-grade. */
  | "declaration_vs_free_text"
  /** Two free-text mentions disagree. Never decision-grade. */
  | "free_text_internal"

/**
 * R2-3. How firmly the posting states the requirement.
 * `INFERRED` covers anything we derived rather than read as an explicit
 * "required" / "must have" / "minimum" statement.
 */
export type RequirementStrength =
  | "MANDATORY_EXPLICIT"
  | "PREFERRED_EXPLICIT"
  | "INFERRED"
  | "UNKNOWN"

/**
 * Where the strength classification came from. An LLM extraction alone can
 * NEVER establish MANDATORY_EXPLICIT — `llm_only` caps strength at INFERRED.
 * Deterministic patterns in the repo that qualify as `deterministic_pattern`:
 * `CERT_REQUIRED_RE` (which requires "required|must have|minimum" before the
 * credential token) and the requirements-section extractor in
 * `extractRequirementsText`.
 */
export type RequirementStrengthProvenance =
  /** Matched a deterministic pattern anchored on explicit requirement wording. */
  | "deterministic_pattern"
  /** Read from a structured ATS field that names it as required. */
  | "structured_ats_field"
  /** Appeared under a requirements-section header with mandatory phrasing. */
  | "section_header_plus_pattern"
  /** Model extraction only. Caps strength at INFERRED. */
  | "llm_only"
  /** Nothing established it. */
  | "none"

/**
 * R2-4. Whether the candidate could obtain a missing credential in time, and
 * on whose authority.
 *
 * THIS REPOSITORY HAS NO CREDENTIAL CATALOG. `CERT_REQUIRED_RE` in
 * `lib/matching/fast-scorer.ts` is an extraction regex over a closed token set
 * (aws certified*, cka, ckad, cks, pmp, cissp, ceh, ccna, ccnp, azure
 * certified*, google certified*); it says nothing about how long any of them
 * takes to obtain. So `catalog` is unreachable until such a table exists, and
 * v0 resolves to `unknown` unless the candidate declares a date.
 *
 * An LLM may not populate this field under any provenance.
 */
export type AcquirabilitySource = "candidate_declared" | "credential_catalog" | "unknown"

export type RequirementAcquirability = {
  source: AcquirabilitySource
  /** Only meaningful when `source !== "unknown"`. Never model-estimated. */
  estimatedDays: number | null
  /** Free-text detail from the candidate, when they declared it. */
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

/**
 * One posting requirement, evaluated against the candidate. The three axes —
 * strength (posting side), presence (candidate side), acquirability (repair
 * side) — are independent and must never be collapsed into a boolean.
 */
export type EvaluatedRequirement = {
  id: string
  kind: RequirementKind
  label: string

  strength: RequirementStrength
  strengthProvenance: RequirementStrengthProvenance
  /** Literal posting span. REQUIRED when strength is MANDATORY_EXPLICIT. */
  strengthExcerpt: string | null

  presence: RequirementPresence
  /** Set only when `presence === "CONTRADICTED"`. */
  contradictionReliability: ContradictionReliability | null
  /** Where in the candidate's data we looked, so the UI can say what it read. */
  searchedIn: Array<"structured_field" | "raw_text" | "candidate_declaration">

  acquirability: RequirementAcquirability

  sourceFactIds: string[]
  confidence: XRayConfidence

  /**
   * Derived, and the ONLY field the decision table reads for a hard skip.
   * True requires ALL of:
   *   strength === "MANDATORY_EXPLICIT"
   *   strengthProvenance !== "llm_only"
   *   presence === "ABSENT_CONFIRMED"
   *     OR (presence === "CONTRADICTED"
   *         AND contradictionReliability === "declaration_vs_structured_field")
   *   acquirability.source !== "candidate_declared" with estimatedDays inside window
   * NOT_FOUND and UNKNOWN can never make this true.
   */
  supportsHardSkip: boolean
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. Hiring Reality
// ═══════════════════════════════════════════════════════════════════════════

export type HiringRealityBand =
  | "LIVE"           // definitive: active, published, board checked recently
  | "LIKELY_LIVE"    // active + published, verification indirect or stale
  | "UNCERTAIN"      // conflicting signals
  | "LIKELY_CLOSED"  // strong but non-definitive closure signals
  | "CLOSED"         // definitive: is_active=false + closed_at, or hidden_expired
  | "UNKNOWN"

export type JobIngestionPath = "harvester" | "legacy_crawler" | "aggregator" | "unknown"

export type JobAvailabilityEvidence = {
  isActive: boolean | null
  publicationStatus: string | null
  closedAt: string | null
  /**
   * False for `legacy_crawler` rows: `lib/crawler/persist.ts` sets
   * is_active=false without reliably setting closed_at or publication_status,
   * so a null closed_at there does not mean "still open".
   */
  closedAtReliable: boolean

  /** jobs.first_detected_at. There is no jobs.first_seen_at column. */
  firstDetectedAt: string | null
  ageDays: number | null

  lastSeenAt: string | null
  /**
   * `persistJobsBulk` historically updated rows only when content_hash changed,
   * so an unchanged live harvester job kept a stale last_seen_at. A working-tree
   * fix now also writes when `jobs.last_seen_at < EXCLUDED.last_seen_at`, but it
   * is FORWARD-ONLY: rows not re-harvested since the fix still carry pre-fix
   * values. Trust requires `last_seen_at >= lastSeenEpochIso`.
   */
  lastSeenAtTrustworthy: boolean
  lastSeenEpochIso: string | null
  ingestionPath: JobIngestionPath

  /** companies.last_crawled_at — the board-level "we checked" proxy. */
  boardLastCheckedAt: string | null
  /** A stale board check caps the band at LIKELY_LIVE. It can never push
   *  toward LIKELY_CLOSED: not-checked is not evidence of closure. */
  boardCheckIsStale: boolean

  /** CAVEAT: probeApplyUrl maps HTTP 401 and 403 to "dead", and 403 is the
   *  routine answer many ATS give a bot HEAD request. Inference, never fact. */
  applyUrlStatus: "ok" | "dead" | "redirect" | "unknown"
  applyUrlProbedAt: string | null
}

export type GhostRiskAssessment = {
  band: IntelligenceRiskLevel // 'low' | 'medium' | 'high' | 'unknown'
  contributingSignals: Array<
    | "age"
    | "apply_url"
    | "similar_active_postings"
    | "location_spread"
    | "description_quality"
    | "salary_disclosure"
    | "link_source"
    | "ats_reliability"
    | "hiring_freeze"
  >
  /**
   * NOT a repost count. `queryRepostCount` counts other ACTIVE similar-title
   * jobs at the same company within 90 days — concurrent openings, not posting
   * cycles. Named honestly so no surface can print "reposted N times".
   */
  concurrentSimilarOpenings: number | null
  /** True until a durable posting-cycle history table exists. */
  repostHistoryUnavailable: true
  computedAt: string | null
  cacheAgeHours: number | null
}

export type EmployerCapacitySignal = {
  healthVerdict: "strong" | "healthy" | "caution" | "critical" | "unknown"
  /**
   * `computeHealthScore` uses neutral defaults for absent data (funding 10,
   * layoff 25, glassdoor 12, headcount 12 = 59 → "healthy"), so a company with
   * NO data renders as healthy. The verdict is usable only when sub-scores had
   * real observations.
   */
  observedSubScoreCount: number
  healthUsable: boolean
  healthComputedAt: string | null

  hiringFreeze: {
    detected: boolean | null
    confidence: "confirmed" | "likely" | "possible" | null
    /** True when this freeze already moved the ghost band; prevents the same
     *  layoff observation being scored twice. */
    alreadyCountedInGhostRisk: boolean
  }

  medianDaysOpen: number | null
  timeToFillSample: number | null
}

export type HiringRealityAssessment = XRayDimension<HiringRealityBand> & {
  availability: JobAvailabilityEvidence
  ghostRisk: GhostRiskAssessment
  employerCapacity: EmployerCapacitySignal
  /** Populated when availability and soft signals disagree. Forces UNCERTAIN
   *  rather than letting the louder score win. */
  conflictingSignals: Array<{ a: string; b: string; resolution: string }>
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. Capability
// ═══════════════════════════════════════════════════════════════════════════

export type CapabilityBand =
  | "EXCEEDS"
  | "MEETS"
  | "NEAR_MISS"   // short of a stated bar but in-lane
  | "STRETCH"     // adjacent lane, real but unproven transfer
  | "MISMATCH"    // different lane, no credible transfer path
  | "UNKNOWN"

export type CapabilityAssessment = XRayDimension<CapabilityBand> & {
  /**
   * From MatchScoreBreakdown.careerFit ONLY.
   * `job_match_scores.overall_score` is FORBIDDEN here: `computeFastScore`
   * folds a sponsorship rank delta (+8/+5/+2 or −6/−18) into `overall` when
   * `profile.needs_sponsorship`, which would double-count work authorization
   * against Eligibility and penalize sponsorship-needing candidates twice.
   */
  careerFitScore: number | null
  careerFitLabel: "ats_ready" | "tailor_resume" | "bridge_first" | "career_pivot" | null

  relevantYears: number | null
  totalYears: number | null
  /** From `extractMinYears`. When `requiredYearsStated` is false this is null
   *  and NO shortfall may be computed — "not stated" is not "zero required". */
  requiredYears: number | null
  requiredYearsStated: boolean
  relevantYearsRatio: number | null

  roleFamily: string | null
  candidateRoleFamilies: string[]
  /** `classifyRoleFamily` mis-fires on multidisciplinary roles — the reason
   *  `computeFastScore` relaxed its own gate to 55. Never decisive alone. */
  roleFamilyCompatible: boolean | "unknown"

  /** All posting requirements, each carrying the three independent axes. */
  requirements: EvaluatedRequirement[]

  /**
   * R2-8. Capability absence must be established by capability evidence
   * (years, role family, an ABSENT_CONFIRMED mandatory requirement) — never by
   * the mere absence of resume text. True only when at least one non-evidence
   * signal supports the mismatch.
   */
  mismatchCorroborationCount: number
  mismatchCorroborations: Array<
    "role_family_incompatible" | "severe_years_shortfall" | "career_fit_below_floor" | "mandatory_absent_confirmed"
  >

  overqualification: {
    detected: boolean
    seniorityGap: number | null
    note: string | null
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. Evidence Strength
// ═══════════════════════════════════════════════════════════════════════════

export type EvidenceBand =
  | "STRONG"
  | "ADEQUATE"
  | "BURIED"        // capability is real but not locatable in structured fields
  | "THIN"          // job terms have no supporting context we could find
  | "UNREADABLE"    // resume absent or unparsed — we could not look

/**
 * R2-8. Why a piece of evidence is not present. This is the evidence-side
 * mirror of `RequirementPresence`, and it exists so that "we did not find it"
 * can never be rendered, scored, or reasoned about as "the candidate lacks it".
 */
export type EvidenceAbsenceKind =
  /** We searched readable candidate data and found nothing. */
  | "NOT_FOUND_IN_READABLE_DATA"
  /** The candidate told us they do not have it. */
  | "CANDIDATE_CONFIRMED_ABSENT"
  /** Candidate-sourced statements conflict. */
  | "EXPLICIT_CONTRADICTION"
  /** We could not read the data at all. */
  | "UNREADABLE_DATA"

/** Mirrors `TailorSkillSuggestion["status"]` in lib/resume/tailor-analysis.ts
 *  so the two never drift. */
export type EvidenceSupportStatus =
  | "present"
  | "missing_supported"           // related context exists (hasIndirectEvidence)
  | "missing_needs_confirmation"  // nothing found; NEVER auto-suggest adding
  | "not_recommended"

export type EvidenceStrengthAssessment = XRayDimension<EvidenceBand> & {
  /** Always "inferred" in v0. There is no claim-level evidence table, so
   *  "verified" is not representable and must not be added without one. */
  verificationLevel: "inferred"

  requirementSupport: Array<{
    requirement: string
    status: EvidenceSupportStatus
    /** Set for every non-`present` status. The field that prevents an absence
     *  from being read as a negative fact. */
    absenceKind: EvidenceAbsenceKind | null
    /** The related-context string from `hasIndirectEvidence`. A WORDING hint,
     *  not proof of the skill. */
    supportingContext: string | null
    locatedIn: "structured_fields" | "raw_text_only" | "not_found"
    sourceFactIds: string[]
  }>

  coverage: {
    requiredTermCount: number
    presentCount: number
    supportedCount: number
    notFoundCount: number
    confirmedAbsentCount: number
    /** presentCount / requiredTermCount. NULL when requiredTermCount is 0 — a
     *  sparse JD must not read as 0% or 100% coverage. */
    presentRatio: number | null
  }

  /** From `buildPositioningBrief().surface`: in raw_text, absent from
   *  summary/skills/titles. The strongest available burial signal. */
  buriedEvidence: string[]

  legibility: {
    parseStatus: "pending" | "processing" | "complete" | "failed" | "absent"
    parseError: string | null
    datedRoleCount: number
    hasRawText: boolean
    blocksAssessment: boolean
  }

  /** Internal-consistency observations phrased for the candidate. Never an
   *  accusation, never shared outward, never a SKIP reason. */
  consistencyNotes: Array<{
    observation: string
    resumeSpanA: string
    resumeSpanB: string
    confidence: XRayConfidence
  }>

  /**
   * Hard invariant, asserted in tests: evidence absence never establishes
   * capability absence. Always false in v0; the field exists so any future
   * change is an explicit, reviewable contract change.
   */
  mayEstablishCapabilityAbsence: false
}

// ═══════════════════════════════════════════════════════════════════════════
// 7. Eligibility — observational only
// ═══════════════════════════════════════════════════════════════════════════

/**
 * R2-6. Observational bands. These describe what the POSTING says relative to
 * what the CANDIDATE told us. They never describe legal standing, and the UI
 * may never render them as "eligible" / "ineligible".
 */
export type EligibilityObservationBand =
  /** Posting language was readable and nothing in it conflicts with what the
   *  candidate told us. */
  | "NO_EXPLICIT_CONFLICT_FOUND"
  /** No conflict now, but the posting or the candidate's timeline implies the
   *  employer would have to act at some point. */
  | "EMPLOYER_ACTION_MAY_BE_NEEDED"
  /** Something is ambiguous — the posting wording, the candidate's data, or
   *  the interaction between them. */
  | "NEEDS_CLARIFICATION"
  /** The posting states a requirement that conflicts with what the candidate
   *  told us. Requires a literal excerpt and KNOWN candidate data. */
  | "EXPLICIT_REQUIREMENT_CONFLICT"
  /** We could not read the posting language, or the candidate never told us. */
  | "UNKNOWN"

/**
 * R2-7. What the posting language is actually about. The repository currently
 * collapses all of these into one boolean (`jobs.requires_authorization`,
 * `boolean DEFAULT false`) via `AUTH_REQUIRED_PATTERNS`, and then
 * `createVisaIntelligenceFallback` labels every hit
 * `requires_unrestricted_work_authorization`. These categories must be
 * re-derived, because they imply different candidate situations and different
 * copy.
 */
export type PostingAuthorizationLanguageCategory =
  /** "we cannot sponsor for this role" — about sponsorship starting now. */
  | "NO_CURRENT_SPONSORSHIP"
  /** "will not sponsor in the future" / "no future sponsorship". */
  | "NO_FUTURE_SPONSORSHIP"
  /** "requires sponsorship now or in the future — will not be considered". */
  | "NO_CURRENT_OR_FUTURE_SPONSORSHIP"
  /** "must possess valid and UNRESTRICTED work authorization", or an explicit
   *  exclusion list naming F-1/OPT/STEM/H-1B/TN. Note: bare "must be authorized
   *  to work" is NOT this category — OPT and H-1B holders are authorized. */
  | "UNRESTRICTED_AUTHORIZATION_REQUIRED"
  | "CITIZENSHIP_REQUIRED"
  | "CLEARANCE_REQUIRED"
  /** Wording exists but does not resolve to a category, e.g. a bare
   *  "must be authorized to work in the US". Never a conflict on its own. */
  | "AMBIGUOUS_GENERAL"
  /** Explicitly offers sponsorship (`AUTH_NOT_REQUIRED_PATTERNS`). */
  | "SPONSORSHIP_OFFERED"

export type PostingAuthorizationRequirement = {
  category: PostingAuthorizationLanguageCategory
  /** Literal matched sentence. Non-optional: an uncitable requirement is
   *  invalid output and must be dropped. */
  excerpt: string
  sourceFactId: string
  confidence: XRayConfidence
  /** True when a deterministic pattern family matched; false when only an LLM
   *  extraction produced it (which can never reach EXPLICIT_REQUIREMENT_CONFLICT). */
  deterministicMatch: boolean
  /** Whether the excerpt also names specific visa categories, which upgrades
   *  UNRESTRICTED_AUTHORIZATION_REQUIRED from inferred to explicit. */
  namesVisaCategories: string[]
}

/** What kind of employer action a candidate's timeline may require. */
export type FutureEmployerActionType =
  | "h1b_petition"
  | "stem_opt_everify_participation"
  | "green_card_sponsorship"
  | "visa_transfer"
  | "other"
  | "unknown"

/**
 * R2-7. Work authorization as a TIMELINE, not a boolean.
 *
 * A candidate on OPT is CURRENTLY AUTHORIZED and may need NO employer action
 * for months or years — while still likely needing action later. Equating
 * "on OPT" with "needs sponsorship now" is the error this type exists to
 * prevent.
 *
 * NOTE ON DEFAULTS: `autofill_profiles.authorized_to_work DEFAULT true`,
 * `requires_sponsorship DEFAULT false`, `profiles.needs_sponsorship DEFAULT false`,
 * `profiles.is_international DEFAULT false`. An empty profile therefore looks
 * exactly like a US citizen. `derivedFromDefaultsOnly` is what stops that.
 */
export type CandidateAuthorizationTimeline = {
  /** Is the candidate authorized to work for this employer TODAY? */
  currentlyAuthorized: boolean | "unknown"
  currentAuthorizationType: WorkAuthorization | VisaStatus | null
  /** e.g. profiles.opt_end_date. Null when unbounded (citizen, green card) or
   *  unknown — the two are distinguished by `currentAuthorizationType`. */
  authorizationEndDate: string | null

  /** Will the employer likely need to act at some point for this candidate to
   *  keep working? Distinct from `currentlyAuthorized`. */
  futureEmployerActionLikely: boolean | "unknown"
  futureActionType: FutureEmployerActionType
  /** Approximate horizon in days before action becomes necessary, from
   *  `authorizationEndDate`. Context for phrasing and ordering ONLY — it may
   *  never change a band or the final action. */
  futureActionHorizonDays: number | null

  /** Which field(s) produced this. The two vocabularies disagree:
   *  `Profile.visa_status` has 'citizen' and no tn_visa;
   *  `AutofillProfile.work_authorization` has 'us_citizen' and 'tn_visa'. */
  readFrom: Array<"profiles.visa_status" | "autofill_profiles.work_authorization" | "candidate_declaration">
  /** True when only schema defaults were available — the trap case. */
  derivedFromDefaultsOnly: boolean
}

/**
 * Probabilistic employer history. May support EMPLOYER_ACTION_MAY_BE_NEEDED
 * commentary. It may NEVER produce EXPLICIT_REQUIREMENT_CONFLICT and may NEVER
 * produce NO_EXPLICIT_CONFLICT_FOUND.
 */
export type SponsorshipHistorySignal = {
  /** Tri-state, NOT `companies.sponsors_h1b` directly: that column is
   *  `boolean DEFAULT false`, so false + zero counts + zero confidence is
   *  UNKNOWN, not "does not sponsor". */
  employerHasSponsored: boolean | "unknown"
  recentPetitionCount: number | null
  totalLcaCount: number | null
  roleFamilyLcaCount: number | null
  roleFamilyMatchMethod: "soc_code" | "soc_title" | "title_family" | "unknown"
  worksiteLcaCount: number | null
  dataAsOf: string | null
  dataStale: boolean

  capExempt: CapExemptSignal | null
  eVerify: "participates" | "not_found" | "unknown"

  /** Required disclaimer the UI must render adjacent to this block. */
  notARolePromise: true
}

/**
 * The candidate-timeline × posting-language decision. Computed deterministically
 * from a documented matrix (see decision-table.md §5.3); no model involvement.
 */
export type AuthorizationConflictEvaluation = {
  requirement: PostingAuthorizationRequirement
  /** Whether this requirement conflicts with the candidate's timeline. */
  outcome:
    | "conflict_now"           // candidate is not currently authorized as required
    | "conflict_future"        // candidate is authorized now; the posting bars the future action
    | "no_conflict"
    | "needs_clarification"    // ambiguous posting wording, or unknown candidate data
    | "unknown"
  /** Plain-language, posting-directed explanation. */
  explanation: string
  confidence: XRayConfidence
  /** True when the candidate's data was known well enough to evaluate. */
  candidateDataSufficient: boolean
}

export type EligibilityAssessment = XRayDimension<EligibilityObservationBand> & {
  candidate: CandidateAuthorizationTimeline
  /** Every authorization-related requirement found in the posting. Empty means
   *  "none found", which is only meaningful when `descriptionWasReadable`. */
  postingRequirements: PostingAuthorizationRequirement[]
  descriptionWasReadable: boolean
  /** One evaluation per posting requirement. */
  conflicts: AuthorizationConflictEvaluation[]

  /** Structurally separate; never merged into `conflicts`. */
  sponsorshipHistory: SponsorshipHistorySignal | null

  /** Non-authorization constraints, kept distinct so copy and severity differ. */
  otherConstraints: Array<{
    kind: "location" | "work_mode" | "employment_type" | "licensure" | "other"
    statement: string
    sourceFactId: string
    candidateConflict: boolean | "unknown"
  }>

  /** Literal type so the renderer cannot omit the disclaimer without a type
   *  error. */
  disclaimerRequired: true
}

// ═══════════════════════════════════════════════════════════════════════════
// 8. Positioning
// ═══════════════════════════════════════════════════════════════════════════

export type PositioningBand = "ALIGNED" | "TUNABLE" | "MISALIGNED" | "UNKNOWN"

export type PositioningAssessment = XRayDimension<PositioningBand> & {
  /** careerFit.atsScreenScore — screen strength, deliberately NOT capability. */
  atsScreenScore: number | null
  /** calculateAtsReadability — format parseability, distinct from keywords. */
  atsReadabilityScore: number | null
  targetAts: AtsType | null
  atsProfileApplied: string | null

  titleAlignment: {
    resumeTitle: string | null
    jobTitle: string
    mirrorsJobTitle: boolean | "unknown"
  }

  /** Only `supportedMissing` may become an actionable edit. */
  supportedMissing: string[]
  /** Display-only, always framed "only if true", never one-click applicable. */
  unsupportedMissing: string[]
  presentKeywords: string[]

  leadWith: string[]
  surfaceFromRawText: string[]
  closeGaps: string[]

  /** Corpus-grounded field context. Absent before the refresh cron has run —
   *  must degrade to UNKNOWN, never to a zero score. */
  fieldContext: {
    targetFieldKey: string | null
    fieldFitScore: number | null
    corpusAvailable: boolean
  } | null

  /** Used ONLY by the repair-window test. Derived from counts of supported
   *  edits; never model-estimated. */
  repairEstimate: {
    supportedEditCount: number
    estimatedMinutes: number | null
    requiresNewEvidence: boolean
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 9. Actionable access
// ═══════════════════════════════════════════════════════════════════════════

/**
 * R2-5. Route types this repository can actually produce, via
 * `getJobNetworkingContacts` in lib/networking/job-contact-finder.ts
 * (exposed at app/api/jobs/[id]/networking/route.ts).
 */
export type AccessRouteType =
  /** linkedin_connections, degree 1. */
  | "direct_connection"
  /** linkedin_connections, degree 2–3, with mutuals. */
  | "second_degree_connection"
  /** cohort_members at the target company (layoff-cohort alumni). */
  | "company_alumni"
  /** cohort_members reachable through a shared cohort. */
  | "cohort_peer"
  /** employer_cohort_requests.contact_email — a real recruiter address. */
  | "employer_recruiter_contact"
  /** A contact the candidate entered themselves. */
  | "candidate_supplied_contact"

/** How the candidate can actually reach the person. At least one concrete
 *  channel is mandatory — a name with no channel is not a route. */
export type AccessRouteChannel =
  | { kind: "linkedin_profile"; url: string }
  | { kind: "email"; address: string }
  | { kind: "internal_referral_form"; url: string }
  | { kind: "cohort_thread"; cohortId: string }

/**
 * A route is only actionable when a real person or channel exists AND the
 * candidate can act on it today. Statistical referral advantage is NOT a route
 * and can never populate this type.
 */
export type ActionableAccessRoute = {
  id: string
  routeType: AccessRouteType

  /** Display name of the person, or the concrete channel's owner. Anonymized
   *  cohort names ("Jane D.") are permitted ONLY when a channel still exists;
   *  `job-contact-finder` nulls `linkedinUrl` for non-members, which makes
   *  those contacts non-actionable and therefore not routes. */
  personName: string | null
  personRole: string | null
  personTeam: string | null

  /** MANDATORY. A route without a reachable channel is invalid output. */
  channel: AccessRouteChannel

  /** Why this person is reachable — the candidate's actual relationship or
   *  the concrete context, e.g. "1st-degree connection, 12 mutuals" or
   *  "posted a hiring request for this company 26 days ago". */
  relationshipContext: string

  /** Exactly what the candidate should do next, in one imperative sentence. */
  nextStep: string

  sourceFactIds: string[]
  /** When the underlying contact record was captured
   *  (linkedin_connections.scraped_at, employer_cohort_requests.created_at,
   *  cohort_members.joined_at). */
  observedAt: string | null
  freshnessDays: number | null
  /** Routes past their type's freshness horizon are dropped, not downgraded. */
  stale: boolean

  confidence: XRayConfidence
}

/**
 * R2-12. Referral-rate statistics are ADVISORY ONLY. They never gate
 * FIND_ACCESS, they never create a route, and they may only be displayed when
 * they clear `MIN_SUBMISSIONS` and the staleness horizon.
 */
export type ReferralAdvantageAdvisory = {
  companyId: string
  normalizedTitle: string
  totalSubmissions: number
  referralScreenRate: number | null
  coldApplyScreenRate: number | null
  deltaPercentagePoints: number | null
  lastComputedAt: string | null
  /** False below MIN_SUBMISSIONS (10) or past the staleness horizon. When
   *  false the advisory must be dropped entirely, not shown at low confidence. */
  displayable: boolean
  /** Literal type: this can never gate an action. */
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
  | "location_or_work_mode"
  | "posting_may_be_closed"
  | "employer_capacity"
  | "cold_apply_disadvantage"
  | "resume_legibility"

export type RejectionRisk = {
  id: string
  kind: RejectionRiskKind
  /** Ordering only. Deliberately not a probability. */
  severity: "critical" | "high" | "moderate" | "low"
  likelihoodBasis: XRayBasis
  statement: string
  dimension: XRayDimensionKey
  sourceFactIds: string[]
  confidence: XRayConfidence
  /** Required when derived from community data. Below MIN_SUBMISSIONS the risk
   *  is dropped, not shown at low confidence. */
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
  | "confirm_requirement_status"      // ask the candidate: do you hold X?
  | "acquire_missing_requirement"
  | "confirm_authorization_timeline"
  | "contact_named_route"             // requires an ActionableAccessRoute
  | "consider_referral_generally"     // advisory only; never the final action
  | "complete_profile"
  | "upload_or_reparse_resume"
  | "choose_different_target"

export type RecommendedAction = {
  id: string
  kind: RecommendedActionKind
  label: string
  rationale: string
  addresses: XRayDimensionKey[]
  addressesRiskIds: string[]
  effort: "minutes" | "hours" | "days" | "weeks_or_more"
  /** True only when every input it needs already exists. False for anything
   *  requiring new experience or a credential we cannot price. */
  doableNow: boolean
  /** True for anything touching a `missing_needs_confirmation` term or a
   *  NOT_FOUND requirement. Such actions are never auto-applicable. */
  requiresCandidateConfirmation: boolean
  /** Set when this action is a confirmation prompt that would change the
   *  decision if answered. Drives the "prominent confirmation" presentation. */
  isDecisionBlockingConfirmation: boolean
  /** Set only for `contact_named_route`. */
  routeId?: string | null
  sourceFactIds: string[]
  target?: { surface: string; params?: Record<string, string> } | null
}

// ═══════════════════════════════════════════════════════════════════════════
// 11. Decision trace
// ═══════════════════════════════════════════════════════════════════════════

/** R2-9. Stages A–I, matching decision-table.md §4 exactly. */
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

export type XRayDecisionTrace = {
  engineVersion: string
  evaluated: Array<{
    stage: XRayDecisionStage
    firedRuleId: string | null
    outcome: "passed_through" | "selected_action" | "skipped_insufficient_input"
    /** The gate/band values the stage read, so the decision is auditable. */
    inputs: Record<string, string | number | boolean | null>
  }>
  selectedStage: XRayDecisionStage
  selectedRuleId: string
  /** Rules that also matched but lost to precedence. */
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
  /** True when the evaluated job differs from the requested one. */
  resolvedFromDuplicate: boolean
  computedAt: string
}

export type ApplicationXRay = {
  schemaVersion: "xray-2026-08-13.r2"
  computedAt: string
  /** Hash of (evaluatedJobId, resumeId, resumeVersion, job content_hash,
   *  engineVersion, fastScoreCacheEpoch). Deterministic invalidation. */
  inputsHash: string

  /** Stage A output. Always present, even when not a duplicate. */
  canonical: CanonicalResolution
  /** The job every dimension was computed against. */
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

  /** Zero or more. FIND_ACCESS is unreachable when this array is empty. */
  accessRoutes: ActionableAccessRoute[]
  /** Advisory only; never gates an action. */
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

  /**
   * Compatibility shim. Written by a one-way adapter so surfaces reading
   * `job_applications.application_verdict` / `JobIntelligence.applicationVerdict`
   * keep working. X-Ray must NEVER read this back as an input.
   */
  legacyVerdictProjection?: {
    verdict: "Apply Today" | "Apply, But Customize Resume" | "Maybe" | "Skip" | "High Risk" | "Unknown"
    recommendation: "apply_now" | "apply_with_tweaks" | "stretch_role" | "skip" | "watch" | "avoid" | "unknown"
    derivedFrom: "application_xray"
  } | null
}

// ═══════════════════════════════════════════════════════════════════════════
// 13. Internal-only (never serialized to a client)
// ═══════════════════════════════════════════════════════════════════════════

/** Raw sub-scores stay server-side. Exposing them invites optimizing a number
 *  instead of reading the finding, and invites us to average them — which is
 *  exactly the failure mode of `calculateApplicationVerdict`. */
export type XRayInternalScores = {
  ghostRiskScore: number | null         // calculateGhostJobRisk 0–100
  visaFitScore: number | null           // calculateVisaFitScore 0–100
  companyHealthTotal: number | null     // computeHealthScore 0–100
  matchOverallScore: number | null      // job_match_scores.overall_score — feed rank ONLY
  atsScreenScore: number | null
  careerFitScore: number | null
  fastScoreGatesTriggered: string[]
  llmVerdict: string | null             // ResumeAnalysis.verdict — display-only
  llmApplyRecommendation: string | null // ResumeAnalysis.apply_recommendation — display-only
}

/** Post-apply linkage. Read-only in v0. */
export type XRayOutcomeLink = {
  applicationId: string | null
  statusAtSnapshot: ApplicationStatus | null
  snapshotFrozenAt: string | null
  /** The status-vocabulary fix has landed in the working tree
   *  (lib/applications/statuses.ts), but a coverage audit has not yet run, so
   *  outcome data is still not decision-usable. */
  outcomeDataUsable: false
}
