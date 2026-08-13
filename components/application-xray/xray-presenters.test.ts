import assert from "node:assert/strict"
import test from "node:test"
import {
  APPLICATION_XRAY_SCHEMA_VERSION,
  type ApplicationXRay,
  type ApplicationXRay as XRay,
  type ApplicationXRay as XRayFixture,
  type XRayDimensionKey,
} from "../../lib/application-xray/types"
import {
  collectXRayPresentationStrings,
  findProhibitedXRayUiLanguage,
  formatXRayDate,
  getDecisionReasons,
  presentAuthorizationNote,
  presentBasis,
  presentConfidence,
  presentDimension,
  presentFinalAction,
  presentRisk,
  presentSourceFact,
  resolveActionLink,
  sanitizePresentationText,
} from "./xray-presenters"

const NOW = "2026-08-13T12:00:00.000Z"
const JOB_ID = "22222222-2222-4222-8222-222222222222"

test("maps all five final actions to approved user labels", () => {
  assert.equal(presentFinalAction("APPLY_NOW").label, "Apply now")
  assert.equal(presentFinalAction("STRENGTHEN_FIRST").label, "Strengthen first")
  assert.equal(presentFinalAction("FIND_ACCESS").label, "Reach out first")
  assert.equal(presentFinalAction("SKIP").label, "Skip this one")
  assert.equal(presentFinalAction("INSUFFICIENT_DATA").label, "Complete your X-Ray")
})

test("maps confidence without numeric odds", () => {
  assert.equal(presentConfidence("high").label, "High confidence")
  assert.equal(presentConfidence("medium").label, "Medium confidence")
  assert.equal(presentConfidence("low").label, "Low confidence")
  assert.equal(presentConfidence("unknown").label, "Confidence unavailable")
})

test("uses all five public dimension titles and questions", () => {
  const xray = makeXRay()
  const keys: XRayDimensionKey[] = ["hiringReality", "capability", "evidence", "eligibility", "positioning"]
  const titles = keys.map((key) => presentDimension(key, xray[key]).title)
  assert.deepEqual(titles, ["Hiring Reality", "Capability", "Evidence Strength", "Posting & Authorization", "Positioning"])
  assert.equal(presentDimension("eligibility", xray.eligibility).question, "Does this posting conflict with what you told us?")
})

test("maps hiring reality bands without raw enum labels", () => {
  for (const band of ["LIVE", "LIKELY_LIVE", "UNCERTAIN", "LIKELY_CLOSED", "CLOSED", "UNKNOWN"] as const) {
    const label = presentDimension("hiringReality", dimension(band)).bandLabel
    assert.equal(label.includes("_"), false)
    assert.notEqual(label, band)
  }
})

test("maps capability bands without using overall match score language", () => {
  for (const band of ["EXCEEDS", "MEETS", "NEAR_MISS", "STRETCH", "MISMATCH", "UNKNOWN"] as const) {
    const presentation = presentDimension("capability", dimension(band))
    assert.equal(presentation.bandLabel.includes("_"), false)
    assert.match(presentation.explanation, /baseline|role|candidate|data/i)
  }
})

test("maps evidence bands as support strength, not proof", () => {
  for (const band of ["STRONG", "ADEQUATE", "BURIED", "THIN", "UNREADABLE"] as const) {
    const presentation = presentDimension("evidence", dimension(band))
    assert.equal(presentation.bandLabel.includes("_"), false)
    assert.equal(/verified evidence/i.test(presentation.explanation), false)
  }
})

test("maps authorization bands without eligibility conclusions", () => {
  for (const band of ["NO_EXPLICIT_CONFLICT_FOUND", "EMPLOYER_ACTION_MAY_BE_NEEDED", "NEEDS_CLARIFICATION", "EXPLICIT_REQUIREMENT_CONFLICT", "UNKNOWN"] as const) {
    const presentation = presentDimension("eligibility", dimension(band))
    assert.equal(presentation.bandLabel.includes("_"), false)
    assert.equal(/eligible|ineligible/i.test(`${presentation.bandLabel} ${presentation.explanation}`), false)
  }
})

test("maps positioning bands without raw enum labels", () => {
  for (const band of ["ALIGNED", "TUNABLE", "MISALIGNED", "UNKNOWN"] as const) {
    const label = presentDimension("positioning", dimension(band)).bandLabel
    assert.equal(label.includes("_"), false)
    assert.notEqual(label, band)
  }
})

test("static presentation strings pass the UI prohibited-language guard", () => {
  const matches = findProhibitedXRayUiLanguage(collectXRayPresentationStrings())
  assert.deepEqual(matches, [])
})

test("UI prohibited-language guard catches forbidden strings", () => {
  const matches = findProhibitedXRayUiLanguage([
    "You are eligible.",
    "Your interview probability is high.",
    "This company will sponsor you.",
  ])
  assert.equal(matches.length, 4)
})

test("presentation sanitizer rewrites risky fallback phrases", () => {
  assert.equal(sanitizePresentationText("ghost job"), "soft posting signal")
  assert.equal(sanitizePresentationText("fake job"), "unreliable posting")
  assert.equal(sanitizePresentationText("you lack Java"), "the resume did not show Java")
})

test("decision reasons use risk and dimension findings with a two-item cap", () => {
  const xray = makeXRay({
    rejectionRisks: [
      { ...risk(), statement: "Soft posting signals should be checked directly." },
    ],
    capability: {
      ...capability(),
      findings: [
        finding("Capability evidence is below the role baseline."),
        finding("Secondary finding."),
      ],
    },
  })
  assert.deepEqual(getDecisionReasons(xray), [
    "Soft posting signals should be checked directly.",
    "Capability evidence is below the role baseline.",
  ])
})

test("OPT with current work authorization and ambiguous future action renders approved caution copy", () => {
  const xray = makeXRay({
    eligibility: {
      ...eligibility(),
      candidate: {
        ...eligibility().candidate,
        canWorkForTargetEmployerWithoutNewImmigrationAction: "YES",
        futureEmployerActions: [{
          type: "STEM_OPT_EVERIFY_PARTICIPATION",
          horizonDays: 120,
          horizonBasis: "candidate timeline",
          status: "POSSIBLE",
          source: "derived_from_status",
          confidence: "medium",
          dataGapIds: [],
          explanation: "Future action may be needed.",
        }],
      },
      postingRequirements: [{
        category: "SPONSORSHIP_SCOPE_AMBIGUOUS",
        excerpt: "No sponsorship.",
        sourceFactId: "fact-auth",
        confidence: "medium",
        deterministicMatch: true,
        temporalScope: "none_present",
        namesVisaCategories: [],
      }],
    },
  })
  assert.equal(
    presentAuthorizationNote(xray),
    "You may be authorized to work now, but this posting does not clarify whether the employer supports future immigration action. Confirm the policy before relying on this opportunity long term.",
  )
})

test("E-Verify NOT_FOUND_IN_SOURCE is distinct from refusal", () => {
  const xray = makeXRay({
    eligibility: {
      ...eligibility(),
      sponsorshipHistory: {
        employerHasSponsored: "unknown",
        recentPetitionCount: null,
        totalLcaCount: null,
        roleFamilyLcaCount: null,
        roleFamilyMatchMethod: "unknown",
        worksiteLcaCount: null,
        dataAsOf: NOW,
        dataStale: false,
        eVerify: {
          participation: "NOT_FOUND_IN_SOURCE",
          sourceName: "stored E-Verify employer data",
          sourceCoverageNote: "The source is incomplete.",
          observedAt: NOW,
          confidence: "medium",
        },
        notARolePromise: true,
      },
    },
  })
  assert.equal(presentAuthorizationNote(xray), "Stored E-Verify data did not find this employer; that is not a confirmed refusal.")
})

test("E-Verify UNKNOWN remains unknown in copy", () => {
  const xray = makeXRay({
    eligibility: {
      ...eligibility(),
      sponsorshipHistory: {
        employerHasSponsored: "unknown",
        recentPetitionCount: null,
        totalLcaCount: null,
        roleFamilyLcaCount: null,
        roleFamilyMatchMethod: "unknown",
        worksiteLcaCount: null,
        dataAsOf: null,
        dataStale: false,
        eVerify: {
          participation: "UNKNOWN",
          sourceName: null,
          sourceCoverageNote: null,
          observedAt: null,
          confidence: "unknown",
        },
        notARolePromise: true,
      },
    },
  })
  assert.equal(presentAuthorizationNote(xray), "E-Verify participation is not known from stored data.")
})

test("source fact excerpts are shortened", () => {
  const presented = presentSourceFact({
    id: "fact",
    kind: "job_description_text",
    basis: "fact",
    confidence: "medium",
    key: "description",
    value: null,
    excerpt: "a".repeat(400),
    observedAt: NOW,
    computedAt: NOW,
    explanation: "Posting excerpt.",
    usableBy: ["hiringReality"],
  })
  assert.equal(presented.excerpt?.length, 220)
})

test("source fact labels hide raw cache names", () => {
  const presented = presentSourceFact({
    id: "fact",
    kind: "ghost_score_cache",
    basis: "inference",
    confidence: "low",
    key: "risk",
    value: null,
    observedAt: null,
    computedAt: NOW,
    explanation: "Cached posting-risk scan.",
    usableBy: ["hiringReality"],
  })
  assert.equal(presented.sourceLabel, "Posting-risk scan")
  assert.equal(/ghost/i.test(presented.sourceLabel), false)
})

test("apply and verify actions link only when an apply URL is present", () => {
  const linked = resolveActionLink(action("verify_posting"), [], { applyUrl: "https://example.com/job", jobId: JOB_ID })
  assert.deepEqual(linked, { type: "link", label: "Open posting", href: "https://example.com/job", external: true })

  const instruction = resolveActionLink(action("verify_posting"), [], { applyUrl: null, jobId: JOB_ID })
  assert.equal(instruction.type, "instruction")
})

test("resume repair actions route to the existing tailor surface with job id", () => {
  const link = resolveActionLink(action("add_supported_keywords"), [], { applyUrl: null, jobId: JOB_ID })
  assert.equal(link.type, "link")
  if (link.type === "link") assert.equal(link.href, `/dashboard/resume/studio?mode=tailor&jobId=${encodeURIComponent(JOB_ID)}`)
})

test("profile and confirmation actions route to the profile surface", () => {
  const link = resolveActionLink(action("confirm_authorization_timeline"), [], { applyUrl: null, jobId: JOB_ID })
  assert.deepEqual(link, { type: "link", label: "Open profile", href: "/dashboard/profile", external: false })
})

test("named email access routes become explicit mailto links", () => {
  const link = resolveActionLink(
    { ...action("contact_named_route"), routeId: "route-1" },
    [{
      id: "route-1",
      routeType: "employer_recruiter_contact",
      personName: "A Recruiter",
      personRole: "Recruiter",
      personTeam: null,
      channel: { kind: "email", address: "recruiter@example.com" },
      relationshipContext: "candidate supplied",
      nextStep: "Send a short note.",
      sourceFactIds: ["fact"],
      observedAt: NOW,
      freshnessDays: 0,
      stale: false,
      confidence: "medium",
    }],
    { applyUrl: null, jobId: JOB_ID },
  )
  assert.deepEqual(link, { type: "link", label: "Email contact", href: "mailto:recruiter@example.com", external: true })
})

test("contact action without a route is not rendered as a fake enabled button", () => {
  const link = resolveActionLink(action("contact_named_route"), [], { applyUrl: null, jobId: JOB_ID })
  assert.equal(link.type, "instruction")
})

test("general referral action points at the existing referral flow", () => {
  const link = resolveActionLink(action("consider_referral_generally"), [], { applyUrl: null, jobId: JOB_ID })
  assert.equal(link.type, "instruction")
  if (link.type === "instruction") assert.match(link.text, /referral button above/i)
})

test("invalid dates render as unavailable", () => {
  assert.equal(formatXRayDate("not-a-date"), "Date not available")
  assert.equal(formatXRayDate(null), "Date not available")
})

test("rendered X-Ray strings are sanitized before language validation", () => {
  const xray = makeXRay({
    sourceFacts: [{
      id: "fact",
      kind: "job_description_text",
      basis: "fact",
      confidence: "medium",
      key: "description",
      value: null,
      excerpt: "This is not a fake job.",
      observedAt: NOW,
      computedAt: NOW,
      explanation: "This is not a ghost job.",
      usableBy: ["hiringReality"],
    }],
  })
  const matches = findProhibitedXRayUiLanguage(collectXRayPresentationStrings(xray))
  assert.deepEqual(matches, [])
})

test("risk basis labels distinguish facts from estimates", () => {
  assert.equal(presentBasis("fact"), "Observed signal")
  assert.equal(presentBasis("inference"), "Inferred from available signals")
  assert.equal(presentBasis("prediction"), "Estimated from available signals")
  assert.equal(presentRisk({ ...risk(), likelihoodBasis: "prediction" }).basisLabel, "Estimated from available signals")
})

function makeXRay(overrides: Partial<XRayFixture> = {}): ApplicationXRay {
  return {
    schemaVersion: APPLICATION_XRAY_SCHEMA_VERSION,
    computedAt: NOW,
    inputsHash: "hash",
    canonical: {
      requestedJobId: JOB_ID,
      evaluatedJobId: JOB_ID,
      outcome: "not_a_duplicate",
      hops: 0,
      canonicalApplyUrl: "https://example.com/job",
      requestedApplyUrl: "https://example.com/job",
      applyUrlDiffers: false,
      sourceFactIds: [],
      note: null,
    },
    evaluatedJobId: JOB_ID,
    requestedJobId: JOB_ID,
    companyId: "33333333-3333-4333-8333-333333333333",
    userId: "11111111-1111-4111-8111-111111111111",
    resumeId: "44444444-4444-4444-8444-444444444444",
    resumeVersion: 1,
    hiringReality: hiringReality(),
    capability: capability(),
    evidence: evidence(),
    eligibility: eligibility(),
    positioning: positioning(),
    accessRoutes: [],
    referralAdvisory: null,
    rejectionRisks: [],
    actions: [],
    finalAction: "APPLY_NOW",
    confidence: "medium",
    headline: "Apply now",
    decisionTrace: {
      engineVersion: "test",
      evaluated: [],
      selectedStage: "I_apply",
      selectedRuleId: "RI2",
      suppressedRuleIds: [],
      tieBreak: null,
    },
    dataGaps: [],
    sourceFacts: [],
    summary: {
      finalAction: "APPLY_NOW",
      confidence: "medium",
      bands: {
        hiringReality: "LIVE",
        capability: "MEETS",
        evidence: "ADEQUATE",
        eligibility: "NO_EXPLICIT_CONFLICT_FOUND",
        positioning: "ALIGNED",
      },
      topRiskId: null,
      resolvedFromDuplicate: false,
      computedAt: NOW,
    },
    legacyVerdictProjection: null,
    ...overrides,
  } as XRay
}

function dimension<TBand extends string>(band: TBand) {
  return {
    band,
    confidence: "medium",
    headline: "Dimension headline",
    findings: [],
    dataGaps: [],
    oldestInputObservedAt: null,
    computedAt: NOW,
    staleInputsDowngraded: false,
  } as unknown as ApplicationXRay[XRayDimensionKey]
}

function hiringReality() {
  return {
    ...dimension("LIVE"),
    availability: {
      isActive: true,
      publicationStatus: "published",
      closedAt: null,
      closedAtReliable: false,
      firstDetectedAt: NOW,
      ageDays: 1,
      lastSeenAt: NOW,
      lastSeenAtTrustworthy: true,
      lastSeenEpochIso: NOW,
      ingestionPath: "harvester",
      boardLastCheckedAt: NOW,
      boardCheckIsStale: false,
      applyUrlStatus: "ok",
      applyUrlProbedAt: NOW,
    },
    ghostRisk: {
      band: "low",
      contributingSignals: [],
      concurrentSimilarOpenings: null,
      repostHistoryUnavailable: true,
      computedAt: NOW,
      cacheAgeHours: 1,
    },
    employerCapacity: {
      healthVerdict: "healthy",
      observedSubScoreCount: 1,
      healthUsable: true,
      healthComputedAt: NOW,
      hiringFreeze: { detected: false, confidence: null, alreadyCountedInGhostRisk: false },
      medianDaysOpen: null,
      timeToFillSample: null,
    },
    conflictingSignals: [],
  } as ApplicationXRay["hiringReality"]
}

function capability() {
  return {
    ...dimension("MEETS"),
    careerFitScore: 78,
    careerFitLabel: "ats_ready",
    relevantYears: 4,
    totalYears: 5,
    requiredYears: 3,
    requiredYearsStated: true,
    relevantYearsRatio: 1.2,
    roleFamily: "software",
    candidateRoleFamilies: ["software"],
    roleFamilyCompatible: true,
    requirements: [],
    mismatchCorroborationCount: 0,
    mismatchCorroborations: [],
    overqualification: { detected: false, seniorityGap: null, note: null },
  } as ApplicationXRay["capability"]
}

function evidence() {
  return {
    ...dimension("ADEQUATE"),
    verificationLevel: "inferred",
    requirementSupport: [],
    coverage: {
      requiredTermCount: 0,
      presentCount: 0,
      supportedCount: 0,
      notFoundCount: 0,
      confirmedAbsentCount: 0,
      presentRatio: null,
    },
    buriedEvidence: [],
    legibility: {
      parseStatus: "complete",
      parseError: null,
      datedRoleCount: 2,
      hasRawText: true,
      blocksAssessment: false,
    },
    consistencyNotes: [],
    mayEstablishCapabilityAbsence: false,
  } as ApplicationXRay["evidence"]
}

function eligibility() {
  return {
    ...dimension("NO_EXPLICIT_CONFLICT_FOUND"),
    candidate: {
      canWorkForTargetEmployerWithoutNewImmigrationAction: "YES",
      targetEmployerAuthorizationExplanation: "Candidate can work for this employer now.",
      declaredVisaStatus: "opt",
      declaredWorkAuthorization: "opt",
      authorizationEndDate: "2026-12-31",
      futureEmployerActions: [],
      readFrom: ["profiles.visa_status"],
      derivedFromDefaultsOnly: false,
      currentAuthorizationType: "temporary_status",
    },
    postingRequirements: [],
    descriptionWasReadable: true,
    conflicts: [],
    employerActionFeasibility: [],
    sponsorshipHistory: null,
    otherConstraints: [],
    disclaimerRequired: true,
  } as ApplicationXRay["eligibility"]
}

function positioning() {
  return {
    ...dimension("ALIGNED"),
    atsScreenScore: null,
    atsReadabilityScore: null,
    targetAts: "greenhouse",
    atsProfileApplied: null,
    titleAlignment: {
      resumeTitle: "Software Engineer",
      jobTitle: "Software Engineer",
      mirrorsJobTitle: true,
    },
    supportedMissing: [],
    unsupportedMissing: [],
    presentKeywords: [],
    leadWith: [],
    surfaceFromRawText: [],
    closeGaps: [],
    fieldContext: null,
    repairEstimate: {
      supportedEditCount: 0,
      estimatedMinutes: null,
      requiresNewEvidence: false,
    },
  } as ApplicationXRay["positioning"]
}

function finding(statement: string) {
  return {
    id: statement,
    statement,
    basis: "fact",
    confidence: "medium",
    impact: "limiting",
    sourceFactIds: [],
    explanation: statement,
  } as ApplicationXRay["capability"]["findings"][number]
}

function risk() {
  return {
    id: "risk",
    kind: "posting_may_be_closed",
    severity: "high",
    likelihoodBasis: "inference",
    statement: "Soft posting signals should be checked directly.",
    dimension: "hiringReality",
    sourceFactIds: [],
    confidence: "low",
    addressableByActionId: null,
  } as ApplicationXRay["rejectionRisks"][number]
}

function action(kind: ApplicationXRay["actions"][number]["kind"]) {
  return {
    id: kind,
    kind,
    label: "Action",
    rationale: "Action rationale.",
    addresses: ["positioning"],
    addressesRiskIds: [],
    effort: "minutes",
    doableNow: true,
    requiresCandidateConfirmation: false,
    isDecisionBlockingConfirmation: false,
    sourceFactIds: [],
    target: null,
  } as ApplicationXRay["actions"][number]
}
