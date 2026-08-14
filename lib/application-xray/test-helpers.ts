import type {
  ApplicationXRayInput,
  ApplicationXRayJobRecord,
  EvidenceSignalInput,
} from "./inputs"
import type {
  ActionableAccessRoute,
  CandidateAuthorizationTimeline,
  EmployerActionFeasibility,
  EvaluatedRequirement,
  FutureEmployerAction,
  RequirementAcquirability,
  PostingAuthorizationLanguageCategory,
  PostingAuthorizationRequirement,
} from "./types"

/**
 * Shared scenario builder. Extracted from scorer.test.ts so the trace-replay
 * suite can construct the same inputs without importing a test file.
 */
export function baseInputForTraceTests(): ApplicationXRayInput {
  return {
    now: "2026-08-13T12:00:00.000Z",
    requestedJobId: "job-1",
    userId: "user-1",
    resume: {
      id: "resume-1",
      version: 3,
      parseStatus: "complete",
      parseError: null,
      hasRawText: true,
      datedRoleCount: 3,
    },
    jobRecords: [job()],
    capability: {
      careerFitScore: 72,
      careerFitLabel: "ats_ready",
      relevantYears: 6,
      totalYears: 7,
      requiredYears: 5,
      requiredYearsStated: true,
      relevantYearsRatio: 1.2,
      roleFamily: "software_engineer",
      candidateRoleFamilies: ["software_engineer"],
      roleFamilyCompatible: true,
      requirements: [],
      mismatchCorroborations: [],
      confidence: "high",
    },
    evidence: {
      requirementSupport: support(5, "present"),
      buriedEvidence: [],
      confidence: "high",
    },
    positioning: {
      atsScreenScore: 82,
      atsReadabilityScore: 88,
      targetAts: "greenhouse",
      atsProfileApplied: "greenhouse",
      resumeTitle: "Software Engineer",
      supportedMissing: [],
      unsupportedMissing: [],
      presentKeywords: ["typescript", "postgres"],
      leadWith: ["typescript"],
      surfaceFromRawText: [],
      closeGaps: [],
      fieldContext: {
        targetFieldKey: "software_engineering",
        fieldFitScore: 74,
        corpusAvailable: true,
      },
      repairEstimate: {
        supportedEditCount: 0,
        estimatedMinutes: 15,
        requiresNewEvidence: false,
      },
      confidence: "high",
    },
    hiringReality: {
      ghostRisk: {
        band: "low",
        contributingSignals: [],
        concurrentSimilarOpenings: null,
        repostHistoryUnavailable: true,
        computedAt: "2026-08-13T11:00:00.000Z",
        cacheAgeHours: 1,
      },
      employerCapacity: {
        healthVerdict: "healthy",
        observedSubScoreCount: 3,
        healthUsable: true,
        healthComputedAt: "2026-08-13T11:00:00.000Z",
        hiringFreeze: {
          detected: false,
          confidence: null,
          alreadyCountedInGhostRisk: false,
        },
        medianDaysOpen: 24,
        timeToFillSample: 30,
      },
      confidence: "high",
    },
    eligibility: {
      candidate: candidate(),
      postingRequirements: [],
      sponsorshipHistory: null,
      otherConstraints: [],
      employerActionFeasibility: [],
      confidence: undefined,
    },
    accessRoutes: [],
    referralAdvisory: null,
    sourceFacts: [
      {
        id: "resume-row",
        kind: "resume_row",
        basis: "fact",
        confidence: "high",
        key: "resumes.id",
        value: "resume-1",
        observedAt: "2026-08-13T10:00:00.000Z",
        computedAt: null,
        explanation: "Resume record read for this evaluation.",
        usableBy: ["capability", "evidence", "positioning"],
      },
      {
        id: "job-row",
        kind: "job_row",
        basis: "fact",
        confidence: "high",
        key: "jobs.id",
        value: "job-1",
        observedAt: "2026-08-13T10:00:00.000Z",
        computedAt: null,
        explanation: "Job record read for this evaluation.",
        usableBy: ["hiringReality", "capability", "evidence", "eligibility", "positioning"],
      },
      {
        id: "fact-route",
        kind: "networking_contacts",
        basis: "fact",
        confidence: "high",
        key: "contact",
        value: "Alex Example",
        excerpt: "Alex Example works on the hiring team.",
        observedAt: "2026-08-13T10:00:00.000Z",
        computedAt: null,
        explanation: "Candidate has a named route.",
        usableBy: ["positioning"],
      },
      {
        id: "fact-auth",
        kind: "job_description_text",
        basis: "fact",
        confidence: "high",
        key: "authorization",
        value: "posting excerpt",
        excerpt: "Posting authorization excerpt.",
        observedAt: "2026-08-13T10:00:00.000Z",
        computedAt: null,
        explanation: "Posting contains deterministic authorization language.",
        usableBy: ["eligibility"],
      },
      {
        id: "fact-everify-refusal",
        kind: "everify_source",
        basis: "fact",
        confidence: "medium",
        key: "everify_refusal",
        value: "will not enroll",
        excerpt: "We will not enroll in E-Verify for this role.",
        observedAt: "2026-08-13T10:00:00.000Z",
        computedAt: null,
        explanation: "Employer directly declined a required employer action.",
        usableBy: ["eligibility"],
      },
    ],
  }
}

function job(overrides: Partial<ApplicationXRayJobRecord> = {}): ApplicationXRayJobRecord {
  return {
    id: "job-1",
    companyId: "company-1",
    duplicateOfId: null,
    title: "Software Engineer",
    applyUrl: "https://jobs.example/job-1",
    contentHash: "hash-1",
    availability: availability(),
    descriptionReadable: true,
    ...overrides,
  }
}

function availability(
  overrides: Partial<ApplicationXRayJobRecord["availability"]> = {},
): ApplicationXRayJobRecord["availability"] {
  return {
    isActive: true,
    publicationStatus: "visible_enriched",
    closedAt: null,
    closedAtReliable: false,
    firstDetectedAt: "2026-08-12T12:00:00.000Z",
    ageDays: 1,
    lastSeenAt: "2026-08-13T11:00:00.000Z",
    lastSeenAtTrustworthy: true,
    lastSeenEpochIso: "2026-08-13T16:00:00.000Z",
    ingestionPath: "harvester",
    boardLastCheckedAt: "2026-08-13T11:00:00.000Z",
    boardCheckIsStale: false,
    applyUrlStatus: "ok",
    applyUrlProbedAt: "2026-08-13T11:00:00.000Z",
    ...overrides,
  }
}

function candidate(
  overrides: Partial<CandidateAuthorizationTimeline> & { canWork?: CandidateAuthorizationTimeline["canWorkForTargetEmployerWithoutNewImmigrationAction"] } = {},
): CandidateAuthorizationTimeline {
  const {
    canWork: suppliedCanWork,
    canWorkForTargetEmployerWithoutNewImmigrationAction,
    ...rest
  } = overrides
  const canWork = suppliedCanWork ?? canWorkForTargetEmployerWithoutNewImmigrationAction ?? "YES"
  return {
    canWorkForTargetEmployerWithoutNewImmigrationAction: canWork,
    targetEmployerAuthorizationExplanation: "Candidate supplied target-employer authorization facts.",
    declaredVisaStatus: canWork === "YES" ? "citizen" : null,
    declaredWorkAuthorization: canWork === "YES" ? "us_citizen" : null,
    authorizationEndDate: null,
    futureEmployerActions: [],
    readFrom: ["profiles.visa_status"],
    derivedFromDefaultsOnly: false,
    currentAuthorizationType: canWork === "YES" ? "citizen" : "temporary_status",
    ...rest,
  }
}

function futureAction(
  type: FutureEmployerAction["type"],
  status: FutureEmployerAction["status"],
): FutureEmployerAction {
  return {
    type,
    horizonDays: type === "H1B_TRANSFER" ? 0 : 120,
    horizonBasis: "fixture",
    status,
    source: "candidate_declaration",
    confidence: "medium",
    dataGapIds: [],
    explanation: `${type} fixture`,
  }
}

function postingRequirement(category: PostingAuthorizationLanguageCategory): PostingAuthorizationRequirement {
  return {
    category,
    excerpt: category === "SPONSORSHIP_SCOPE_AMBIGUOUS"
      ? "We are unable to provide sponsorship for this position."
      : "Deterministic authorization requirement.",
    sourceFactId: "fact-auth",
    confidence: "high",
    deterministicMatch: true,
    temporalScope: category === "NO_FUTURE_SPONSORSHIP"
      ? "in_the_future"
      : category === "NO_CURRENT_OR_FUTURE_SPONSORSHIP"
        ? "now_or_in_the_future"
        : category === "NO_CURRENT_SPONSORSHIP"
          ? "start_employment"
          : "none_present",
    namesVisaCategories: category === "UNRESTRICTED_AUTHORIZATION_REQUIRED" ? ["OPT"] : [],
  }
}

type RequirementOverrides = Partial<Omit<EvaluatedRequirement, "acquirability">> & {
  acquirability?: Partial<RequirementAcquirability>
}

function requirement(overrides: RequirementOverrides = {}): EvaluatedRequirement {
  const { acquirability, ...rest } = overrides
  return {
    id: "req-cpa",
    kind: "certification",
    label: "CPA",
    strength: "MANDATORY_EXPLICIT",
    strengthProvenance: "deterministic_pattern",
    strengthExcerpt: "Active CPA license required.",
    presence: "NOT_FOUND",
    contradictionReliability: null,
    searchedIn: ["structured_field", "raw_text"],
    sourceFactIds: ["fact-auth"],
    confidence: "high",
    supportsHardSkip: false,
    ...rest,
    acquirability: {
      source: acquirability?.source ?? "unknown",
      estimatedDays: acquirability?.estimatedDays ?? null,
      candidateNote: acquirability?.candidateNote ?? null,
      sourceFactIds: acquirability?.sourceFactIds ?? [],
    },
  }
}

function support(
  count: number,
  status: EvidenceSignalInput["requirementSupport"][number]["status"],
): EvidenceSignalInput["requirementSupport"] {
  return Array.from({ length: count }, (_, index) => ({
    requirement: `term-${index}`,
    status,
    absenceKind: status === "present" || status === "missing_supported" ? null : "NOT_FOUND_IN_READABLE_DATA",
    supportingContext: status === "missing_supported" ? "related wording found" : null,
    locatedIn: status === "present" ? "structured_fields" : status === "missing_supported" ? "raw_text_only" : "not_found",
    // Mirrors the production mapper: a located claim cites the resume it was
    // read from plus the posting whose terms it was judged against; a
    // not-found item cites only the posting, because it is a statement about
    // the search rather than about a span.
    sourceFactIds: status === "present" || status === "missing_supported"
      ? ["resume-row", "job-row"]
      : ["job-row"],
  }))
}

function route(overrides: Partial<ActionableAccessRoute> = {}): ActionableAccessRoute {
  return {
    id: "route-1",
    routeType: "direct_connection",
    personName: "Alex Example",
    personRole: "Engineering Manager",
    personTeam: "Platform",
    channel: { kind: "linkedin_profile", url: "https://linkedin.example/alex" },
    relationshipContext: "Former teammate",
    nextStep: "Ask Alex whether the role is still active and who owns the opening.",
    sourceFactIds: ["fact-route"],
    observedAt: "2026-08-13T10:00:00.000Z",
    freshnessDays: 0,
    stale: false,
    confidence: "high",
    ...overrides,
  }
}

function withClosed(input: ApplicationXRayInput): ApplicationXRayInput {
  input.jobRecords[0] = job({
    availability: availability({
      isActive: false,
      publicationStatus: "hidden_expired",
      closedAt: "2026-08-11T00:00:00.000Z",
      closedAtReliable: true,
    }),
  })
  return input
}

function withAuthRequirement(
  input: ApplicationXRayInput,
  category: PostingAuthorizationLanguageCategory,
  authCandidate: CandidateAuthorizationTimeline,
): ApplicationXRayInput {
  input.eligibility.candidate = authCandidate
  input.eligibility.postingRequirements = [postingRequirement(category)]
  input.eligibility.confidence = undefined
  return input
}

function withEmployerActionRefused(
  input: ApplicationXRayInput,
  candidateRequiresAction: EmployerActionFeasibility["candidateRequiresAction"],
): ApplicationXRayInput {
  input.eligibility.candidate = candidate({
    canWork: "YES",
    declaredVisaStatus: "opt",
    declaredWorkAuthorization: "opt",
    currentAuthorizationType: "temporary_status",
    futureEmployerActions: [futureAction("STEM_OPT_EVERIFY_PARTICIPATION", "REQUIRED")],
  })
  input.eligibility.employerActionFeasibility = [
    {
      actionType: "STEM_OPT_EVERIFY_PARTICIPATION",
      status: "REFUSED_CONFIRMED",
      employerStatementExcerpt: "We will not enroll in E-Verify for this role.",
      candidateRequiresAction,
      sourceFactIds: ["fact-everify-refusal"],
      confidence: "medium",
    },
  ]
  return input
}

function withRequirement(input: ApplicationXRayInput, req: EvaluatedRequirement): ApplicationXRayInput {
  input.capability.requirements = [req]
  return input
}

function withUnreadableResume(input: ApplicationXRayInput): ApplicationXRayInput {
  input.resume = null
  input.capability.careerFitScore = null
  input.positioning.atsScreenScore = null
  input.positioning.bandHint = "UNKNOWN"
  return input
}

function withNoDatedRoles(input: ApplicationXRayInput): ApplicationXRayInput {
  input.resume = { ...input.resume!, datedRoleCount: 0 }
  return input
}

function withMismatch(input: ApplicationXRayInput): ApplicationXRayInput {
  input.capability.careerFitScore = 34
  input.capability.relevantYearsRatio = 0.2
  input.capability.roleFamilyCompatible = false
  input.capability.mismatchCorroborations = [
    "role_family_incompatible",
    "severe_years_shortfall",
    "career_fit_below_floor",
  ]
  return input
}

function withSevereStretch(input: ApplicationXRayInput): ApplicationXRayInput {
  input.capability.careerFitScore = 46
  input.capability.careerFitLabel = "bridge_first"
  input.capability.relevantYearsRatio = 0.38
  input.capability.mismatchCorroborations = ["severe_years_shortfall"]
  input.positioning.repairEstimate.estimatedMinutes = 120
  input.jobRecords[0] = job({ availability: availability({ ageDays: 4, firstDetectedAt: "2026-08-09T12:00:00.000Z" }) })
  return input
}

function withBuriedEvidence(input: ApplicationXRayInput): ApplicationXRayInput {
  input.evidence.requirementSupport = [
    ...support(2, "present"),
    ...support(3, "missing_supported"),
  ]
  input.evidence.buriedEvidence = ["Airflow"]
  input.positioning.supportedMissing = ["Airflow"]
  input.positioning.surfaceFromRawText = ["Airflow"]
  input.positioning.repairEstimate.supportedEditCount = 1
  input.positioning.repairEstimate.estimatedMinutes = 20
  return input
}

function withThinRepairableEvidence(input: ApplicationXRayInput): ApplicationXRayInput {
  input.capability.careerFitScore = 58
  input.evidence.requirementSupport = [
    ...support(3, "present"),
    ...support(4, "missing_supported"),
    ...support(5, "missing_needs_confirmation"),
  ]
  input.positioning.supportedMissing = ["Kubernetes"]
  input.positioning.repairEstimate.supportedEditCount = 1
  input.positioning.repairEstimate.estimatedMinutes = 20
  return input
}

function withThinEstablishedCapability(input: ApplicationXRayInput): ApplicationXRayInput {
  input.capability.careerFitScore = 72
  input.evidence.requirementSupport = [
    ...support(2, "present"),
    ...support(5, "missing_needs_confirmation"),
  ]
  return input
}

function withMisalignedRepairablePositioning(input: ApplicationXRayInput): ApplicationXRayInput {
  input.positioning.bandHint = "MISALIGNED"
  input.positioning.supportedMissing = ["React"]
  input.positioning.repairEstimate.supportedEditCount = 2
  input.positioning.repairEstimate.estimatedMinutes = 60
  input.positioning.repairEstimate.requiresNewEvidence = false
  input.jobRecords[0] = job({ availability: availability({ ageDays: 4, firstDetectedAt: "2026-08-09T12:00:00.000Z" }) })
  return input
}

function withTunablePositioning(input: ApplicationXRayInput): ApplicationXRayInput {
  input.positioning.supportedMissing = ["GraphQL"]
  input.positioning.repairEstimate.supportedEditCount = 1
  input.positioning.repairEstimate.estimatedMinutes = 15
  return input
}

function withMisalignedUnrepairablePositioning(input: ApplicationXRayInput): ApplicationXRayInput {
  input.positioning.bandHint = "MISALIGNED"
  input.positioning.unsupportedMissing = ["embedded C"]
  input.positioning.repairEstimate.requiresNewEvidence = true
  input.positioning.repairEstimate.supportedEditCount = 0
  return input
}

function withRoute(input: ApplicationXRayInput): ApplicationXRayInput {
  input.accessRoutes = [route()]
  return input
}

function withDeadApplyUrl(input: ApplicationXRayInput): ApplicationXRayInput {
  input.jobRecords[0] = job({
    availability: availability({ applyUrlStatus: "dead", applyUrlProbedAt: "2026-08-13T11:30:00.000Z" }),
  })
  return input
}
