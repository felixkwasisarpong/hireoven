import assert from "node:assert/strict"
import test from "node:test"
import { scoreApplicationXRay } from "./scorer"
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
  XRayFinalAction,
} from "./types"

test("baseline strong application falls through to APPLY_NOW / RI2", () => {
  const xray = scoreApplicationXRay(baseInput())

  assertDecision(xray.finalAction, xray.decisionTrace.selectedRuleId, "APPLY_NOW", "RI2")
  assert.equal(xray.summary.bands.capability, "MEETS")
  assert.equal(xray.legacyVerdictProjection?.derivedFrom, "application_xray")
})

test("every final action is reachable", () => {
  assert.equal(scoreApplicationXRay(baseInput()).finalAction, "APPLY_NOW")

  const strengthen = baseInput()
  strengthen.capability.careerFitScore = 46
  strengthen.capability.careerFitLabel = "bridge_first"
  strengthen.capability.requiredYearsStated = true
  strengthen.capability.relevantYearsRatio = 0.38
  strengthen.capability.mismatchCorroborations = ["severe_years_shortfall"]
  strengthen.positioning.repairEstimate.estimatedMinutes = 120
  strengthen.jobRecords[0] = job({ availability: availability({ ageDays: 4, firstDetectedAt: "2026-08-09T12:00:00.000Z" }) })
  assert.equal(scoreApplicationXRay(strengthen).finalAction, "STRENGTHEN_FIRST")

  const access = baseInput()
  access.accessRoutes = [route()]
  assert.equal(scoreApplicationXRay(access).finalAction, "FIND_ACCESS")

  const closed = baseInput()
  closed.jobRecords[0] = job({ availability: availability({ isActive: false, closedAt: "2026-08-01T00:00:00.000Z", closedAtReliable: true }) })
  assert.equal(scoreApplicationXRay(closed).finalAction, "SKIP")

  const missing = baseInput()
  missing.resume = null
  assert.equal(scoreApplicationXRay(missing).finalAction, "INSUFFICIENT_DATA")
})

test("decision table rules RB1 through RI2 are exercised", () => {
  const cases: Array<[string, ApplicationXRayInput, XRayFinalAction]> = [
    ["RB1", withClosed(baseInput()), "SKIP"],
    ["RC1", withAuthRequirement(baseInput(), "NO_CURRENT_SPONSORSHIP", candidate({ canWork: "NO" })), "SKIP"],
    [
      "RC2",
      withAuthRequirement(
        baseInput(),
        "NO_CURRENT_OR_FUTURE_SPONSORSHIP",
        candidate({ canWork: "YES", futureEmployerActions: [futureAction("H1B_PETITION", "POSSIBLE")] }),
      ),
      "SKIP",
    ],
    ["RC3", withRequirement(baseInput(), requirement({ presence: "ABSENT_CONFIRMED" })), "SKIP"],
    ["RC4", withEmployerActionRefused(baseInput(), true), "SKIP"],
    ["RD1", withUnreadableResume(baseInput()), "INSUFFICIENT_DATA"],
    [
      "RD2",
      withAuthRequirement(
        baseInput(),
        "SPONSORSHIP_SCOPE_AMBIGUOUS",
        candidate({ canWork: "UNKNOWN", derivedFromDefaultsOnly: true }),
      ),
      "INSUFFICIENT_DATA",
    ],
    ["RE1", withMismatch(baseInput()), "SKIP"],
    ["RE2", withSevereStretch(baseInput()), "STRENGTHEN_FIRST"],
    ["RE3", withRequirement(baseInput(), requirement({ presence: "NOT_FOUND" })), "STRENGTHEN_FIRST"],
    [
      "RE4",
      withRequirement(
        baseInput(),
        requirement({
          presence: "ABSENT_CONFIRMED",
          acquirability: { source: "candidate_declared", estimatedDays: 10, candidateNote: "exam booked", sourceFactIds: ["fact-acq"] },
        }),
      ),
      "STRENGTHEN_FIRST",
    ],
    ["RF1", withNoDatedRoles(baseInput()), "STRENGTHEN_FIRST"],
    ["RF2", withBuriedEvidence(baseInput()), "STRENGTHEN_FIRST"],
    ["RF3", withThinRepairableEvidence(baseInput()), "STRENGTHEN_FIRST"],
    ["RF4", withThinEstablishedCapability(baseInput()), "APPLY_NOW"],
    ["RG1", withMisalignedRepairablePositioning(baseInput()), "STRENGTHEN_FIRST"],
    ["RG2", withTunablePositioning(baseInput()), "STRENGTHEN_FIRST"],
    ["RG3", withMisalignedUnrepairablePositioning(baseInput()), "APPLY_NOW"],
    ["RH1", withRoute(baseInput()), "FIND_ACCESS"],
    ["RI1", withDeadApplyUrl(baseInput()), "APPLY_NOW"],
    ["RI2", baseInput(), "APPLY_NOW"],
  ]

  for (const [ruleId, input, action] of cases) {
    const xray = scoreApplicationXRay(input)
    if (["RF4", "RG3"].includes(ruleId)) {
      assert.ok(
        xray.decisionTrace.evaluated.some((row) => row.firedRuleId === ruleId),
        `${ruleId} should be recorded as a fall-through rule`,
      )
      assert.equal(xray.decisionTrace.selectedRuleId, "RI2")
    } else {
      assertDecision(xray.finalAction, xray.decisionTrace.selectedRuleId, action, ruleId)
    }
  }
})

test("ambiguous sponsorship with an OPT future-action timeline applies with clarification", () => {
  const input = withAuthRequirement(
    baseInput(),
    "SPONSORSHIP_SCOPE_AMBIGUOUS",
    candidate({
      canWork: "YES",
      futureEmployerActions: [
        futureAction("STEM_OPT_EVERIFY_PARTICIPATION", "POSSIBLE"),
        futureAction("STEM_OPT_I983", "POSSIBLE"),
        futureAction("H1B_PETITION", "POSSIBLE"),
      ],
    }),
  )

  const xray = scoreApplicationXRay(input)

  assertDecision(xray.finalAction, xray.decisionTrace.selectedRuleId, "APPLY_NOW", "RI2")
  assert.equal(xray.eligibility.band, "NEEDS_CLARIFICATION")
  assert.equal(xray.eligibility.conflicts[0]?.requirement.category, "SPONSORSHIP_SCOPE_AMBIGUOUS")
  assert.equal(xray.eligibility.conflicts[0]?.outcome, "needs_clarification")
  assert.equal(xray.confidence, "low")
  assert.ok(xray.actions.some((action) => action.kind === "confirm_future_sponsorship_policy"))
})

test("unknown candidate timeline makes the same ambiguous posting decision-blocking", () => {
  const input = withAuthRequirement(
    baseInput(),
    "SPONSORSHIP_SCOPE_AMBIGUOUS",
    candidate({ canWork: "UNKNOWN", derivedFromDefaultsOnly: true }),
  )

  const xray = scoreApplicationXRay(input)

  assertDecision(xray.finalAction, xray.decisionTrace.selectedRuleId, "INSUFFICIENT_DATA", "RD2")
  assert.ok(xray.actions.some((action) => action.kind === "confirm_authorization_timeline" && action.isDecisionBlockingConfirmation))
})

test("E-Verify unknown and not-found states do not skip", () => {
  for (const status of ["UNKNOWN", "NOT_FOUND"] satisfies EmployerActionFeasibility["status"][]) {
    const input = baseInput()
    input.eligibility.candidate = candidate({
      canWork: "YES",
      declaredVisaStatus: "opt",
      declaredWorkAuthorization: "opt",
      currentAuthorizationType: "temporary_status",
      futureEmployerActions: [
        futureAction("STEM_OPT_EVERIFY_PARTICIPATION", "REQUIRED"),
        futureAction("STEM_OPT_I983", "REQUIRED"),
      ],
    })
    input.eligibility.employerActionFeasibility = [
      {
        actionType: "STEM_OPT_EVERIFY_PARTICIPATION",
        status,
        employerStatementExcerpt: null,
        candidateRequiresAction: status === "UNKNOWN" ? "unknown" : true,
        sourceFactIds: status === "NOT_FOUND" ? ["fact-everify"] : [],
        confidence: "medium",
      },
    ]

    const xray = scoreApplicationXRay(input)
    assertDecision(xray.finalAction, xray.decisionTrace.selectedRuleId, "APPLY_NOW", "RI2")
    assert.equal(xray.eligibility.band, "EMPLOYER_ACTION_MAY_BE_NEEDED")
  }
})

test("confirmed employer refusal skips only when the candidate-required action is confirmed", () => {
  const unconfirmed = scoreApplicationXRay(withEmployerActionRefused(baseInput(), "unknown"))
  assertDecision(unconfirmed.finalAction, unconfirmed.decisionTrace.selectedRuleId, "APPLY_NOW", "RI2")
  assert.equal(unconfirmed.eligibility.band, "EMPLOYER_ACTION_MAY_BE_NEEDED")
  assert.equal(unconfirmed.confidence, "low")
  assert.ok(unconfirmed.actions.some((action) => action.kind === "confirm_stem_opt_requirement"))

  const confirmed = scoreApplicationXRay(withEmployerActionRefused(baseInput(), true))
  assertDecision(confirmed.finalAction, confirmed.decisionTrace.selectedRuleId, "SKIP", "RC4")
  assert.equal(confirmed.eligibility.candidate.canWorkForTargetEmployerWithoutNewImmigrationAction, "YES")
  assert.equal(confirmed.eligibility.conflicts.length, 0)
  assert.equal(confirmed.eligibility.band, "EXPLICIT_REQUIREMENT_CONFLICT")
  assert.equal(confirmed.confidence, "medium")
  assert.ok(confirmed.actions.some((action) => action.kind === "choose_different_target"))
})

test("RC4 requires cited employer refusal, candidate-required action, and medium confidence", () => {
  const cases: Array<[string, (input: ApplicationXRayInput) => void]> = [
    ["missing source facts", (input) => { input.eligibility.employerActionFeasibility[0]!.sourceFactIds = [] }],
    ["missing employer excerpt", (input) => { input.eligibility.employerActionFeasibility[0]!.employerStatementExcerpt = null }],
    ["low confidence", (input) => { input.eligibility.employerActionFeasibility[0]!.confidence = "low" }],
    ["candidate need unknown", (input) => { input.eligibility.employerActionFeasibility[0]!.candidateRequiresAction = "unknown" }],
  ]

  for (const [label, mutate] of cases) {
    const input = withEmployerActionRefused(baseInput(), true)
    mutate(input)
    const xray = scoreApplicationXRay(input)
    assertDecision(xray.finalAction, xray.decisionTrace.selectedRuleId, "APPLY_NOW", "RI2")
    assert.equal(xray.eligibility.band, "EMPLOYER_ACTION_MAY_BE_NEEDED", label)
  }
})

test("every SKIP path carries a forward action", () => {
  const skipInputs = [
    withClosed(baseInput()),
    withAuthRequirement(baseInput(), "NO_CURRENT_SPONSORSHIP", candidate({ canWork: "NO" })),
    withAuthRequirement(
      baseInput(),
      "NO_CURRENT_OR_FUTURE_SPONSORSHIP",
      candidate({ canWork: "YES", futureEmployerActions: [futureAction("H1B_PETITION", "POSSIBLE")] }),
    ),
    withRequirement(baseInput(), requirement({ presence: "ABSENT_CONFIRMED" })),
    withEmployerActionRefused(baseInput(), true),
    withMismatch(baseInput()),
  ]

  for (const input of skipInputs) {
    const xray = scoreApplicationXRay(input)
    assert.equal(xray.finalAction, "SKIP")
    assert.ok(xray.actions.some((action) => action.kind === "choose_different_target"))
  }
})

test("canonical duplicates evaluate the canonical row and unresolved chains do not skip", () => {
  const canonical = baseInput()
  canonical.requestedJobId = "job-canon"
  canonical.jobRecords = [job({ id: "job-canon", applyUrl: "https://jobs.example/canon" })]
  const direct = scoreApplicationXRay(canonical)

  const duplicate = baseInput()
  duplicate.requestedJobId = "job-dup"
  duplicate.jobRecords = [
    job({ id: "job-dup", duplicateOfId: "job-canon", applyUrl: "https://jobs.example/dup" }),
    job({ id: "job-canon", applyUrl: "https://jobs.example/canon" }),
  ]
  const deduped = scoreApplicationXRay(duplicate)

  assert.equal(deduped.canonical.outcome, "resolved")
  assert.equal(deduped.summary.bands.capability, direct.summary.bands.capability)
  assert.equal(deduped.decisionTrace.selectedRuleId, direct.decisionTrace.selectedRuleId)
  assert.equal(deduped.finalAction, direct.finalAction)
  assert.ok(deduped.actions.some((action) => action.kind === "apply_to_canonical_posting"))

  const dangling = baseInput()
  dangling.jobRecords[0] = job({ duplicateOfId: "missing-job" })
  assertDecision(scoreApplicationXRay(dangling).finalAction, scoreApplicationXRay(dangling).decisionTrace.selectedRuleId, "INSUFFICIENT_DATA", "RD1")

  const cyclic = baseInput()
  cyclic.requestedJobId = "a"
  cyclic.jobRecords = [job({ id: "a", duplicateOfId: "b" }), job({ id: "b", duplicateOfId: "a" })]
  const cycleResult = scoreApplicationXRay(cyclic)
  assert.equal(cycleResult.canonical.outcome, "unresolved_canonical_invalid")
  assertDecision(cycleResult.finalAction, cycleResult.decisionTrace.selectedRuleId, "INSUFFICIENT_DATA", "RD1")
})

test("dead apply URL and untrusted last_seen_at remain uncertainty signals", () => {
  const dead = scoreApplicationXRay(withDeadApplyUrl(baseInput()))
  assert.equal(dead.hiringReality.band, "UNCERTAIN")
  assertDecision(dead.finalAction, dead.decisionTrace.selectedRuleId, "APPLY_NOW", "RI1")
  assert.ok(dead.actions.some((action) => action.kind === "verify_posting"))

  const staleUntrusted = baseInput()
  staleUntrusted.jobRecords[0] = job({
    availability: availability({
      lastSeenAt: "2026-07-01T00:00:00.000Z",
      lastSeenAtTrustworthy: false,
      boardLastCheckedAt: "2026-08-13T00:00:00.000Z",
    }),
  })
  assert.equal(scoreApplicationXRay(staleUntrusted).hiringReality.band, "LIVE")
})

test("actionable access requires a real route, not referral statistics alone", () => {
  const statsOnly = baseInput()
  statsOnly.referralAdvisory = {
    companyId: "company-1",
    normalizedTitle: "software engineer",
    totalSubmissions: 40,
    referralScreenRate: 0.4,
    coldApplyScreenRate: 0.12,
    deltaPercentagePoints: 28,
    lastComputedAt: "2026-08-13T00:00:00.000Z",
    displayable: true,
    gatesFinalAction: false,
  }
  assertDecision(scoreApplicationXRay(statsOnly).finalAction, scoreApplicationXRay(statsOnly).decisionTrace.selectedRuleId, "APPLY_NOW", "RI2")

  const access = withRoute(statsOnly)
  assertDecision(scoreApplicationXRay(access).finalAction, scoreApplicationXRay(access).decisionTrace.selectedRuleId, "FIND_ACCESS", "RH1")
})

test("hot-window repair falls through to apply while recording the suppressed repair rule", () => {
  const input = withBuriedEvidence(baseInput())
  input.jobRecords[0] = job({ availability: availability({ ageDays: 0.2, firstDetectedAt: "2026-08-13T07:00:00.000Z" }) })
  input.positioning.repairEstimate.estimatedMinutes = 120

  const xray = scoreApplicationXRay(input)
  assertDecision(xray.finalAction, xray.decisionTrace.selectedRuleId, "APPLY_NOW", "RI2")
  assert.ok(xray.decisionTrace.evaluated.some((row) => row.firedRuleId === "RF2"))
})

test("eligibility conflicts do not rewrite capability", () => {
  const input = withAuthRequirement(baseInput(), "NO_CURRENT_SPONSORSHIP", candidate({ canWork: "NO" }))
  const xray = scoreApplicationXRay(input)

  assert.equal(xray.capability.band, "MEETS")
  assert.equal(xray.capability.careerFitScore, 72)
  assertDecision(xray.finalAction, xray.decisionTrace.selectedRuleId, "SKIP", "RC1")
})

test("output is deterministic under shuffled object key order", () => {
  const input = withAuthRequirement(
    withRoute(baseInput()),
    "SPONSORSHIP_SCOPE_AMBIGUOUS",
    candidate({ canWork: "YES", futureEmployerActions: [futureAction("H1B_PETITION", "POSSIBLE")] }),
  )
  const shuffled = shuffleObjectKeys(input) as ApplicationXRayInput

  assert.deepEqual(scoreApplicationXRay(shuffled), scoreApplicationXRay(input))
})

function baseInput(): ApplicationXRayInput {
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
    sourceFactIds: [],
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

function assertDecision(
  actualAction: XRayFinalAction,
  actualRule: string,
  expectedAction: XRayFinalAction,
  expectedRule: string,
): void {
  assert.equal(actualAction, expectedAction, expectedRule)
  assert.equal(actualRule, expectedRule)
}

function shuffleObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(shuffleObjectKeys)
  if (!value || typeof value !== "object") return value
  return Object.keys(value as Record<string, unknown>)
    .sort()
    .reverse()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = shuffleObjectKeys((value as Record<string, unknown>)[key])
      return acc
    }, {})
}
