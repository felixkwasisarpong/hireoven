import assert from "node:assert/strict"
import test from "node:test"
import { collectRenderedStrings, findProhibitedXRayLanguage } from "./prohibited-language"
import { scoreApplicationXRay } from "./scorer"
import type { ApplicationXRayInput } from "./inputs"

test("rendered Application X-Ray strings avoid prohibited legal, probability, and dishonesty language", () => {
  const input = minimalInput()
  input.eligibility.candidate = {
    ...input.eligibility.candidate,
    canWorkForTargetEmployerWithoutNewImmigrationAction: "NO",
    declaredVisaStatus: null,
    declaredWorkAuthorization: "require_sponsorship",
    currentAuthorizationType: "temporary_status",
  }
  input.eligibility.postingRequirements = [{
    category: "NO_CURRENT_SPONSORSHIP",
    excerpt: "Applicants must be able to begin employment without sponsorship.",
    sourceFactId: "fact-auth",
    confidence: "high",
    deterministicMatch: true,
    temporalScope: "start_employment",
    namesVisaCategories: [],
  }]

  const matches = findProhibitedXRayLanguage(collectRenderedStrings(scoreApplicationXRay(input)))
  assert.deepEqual(matches, [])
})

test("prohibited language guard catches unsafe strings", () => {
  assert.deepEqual(findProhibitedXRayLanguage(["You are not eligible for this job."]), [{
    pattern: "\\byou are not eligible\\b",
    text: "You are not eligible for this job.",
  }])
})

function minimalInput(): ApplicationXRayInput {
  return {
    now: "2026-08-13T12:00:00.000Z",
    requestedJobId: "job-1",
    userId: "user-1",
    resume: {
      id: "resume-1",
      version: 1,
      parseStatus: "complete",
      parseError: null,
      hasRawText: true,
      datedRoleCount: 2,
    },
    jobRecords: [{
      id: "job-1",
      companyId: "company-1",
      duplicateOfId: null,
      title: "Software Engineer",
      applyUrl: "https://jobs.example/job-1",
      contentHash: "hash-1",
      descriptionReadable: true,
      availability: {
        isActive: true,
        publicationStatus: "visible_enriched",
        closedAt: null,
        closedAtReliable: false,
        firstDetectedAt: "2026-08-13T00:00:00.000Z",
        ageDays: 0,
        lastSeenAt: "2026-08-13T10:00:00.000Z",
        lastSeenAtTrustworthy: true,
        lastSeenEpochIso: "2026-08-13T16:00:00.000Z",
        ingestionPath: "harvester",
        boardLastCheckedAt: "2026-08-13T11:00:00.000Z",
        boardCheckIsStale: false,
        applyUrlStatus: "ok",
        applyUrlProbedAt: "2026-08-13T11:00:00.000Z",
      },
    }],
    capability: {
      careerFitScore: 72,
      careerFitLabel: "ats_ready",
      relevantYears: 5,
      totalYears: 6,
      requiredYears: 4,
      requiredYearsStated: true,
      relevantYearsRatio: 1.25,
      roleFamily: "software_engineer",
      candidateRoleFamilies: ["software_engineer"],
      roleFamilyCompatible: true,
      requirements: [],
      mismatchCorroborations: [],
      confidence: "high",
    },
    evidence: {
      requirementSupport: [{
        requirement: "typescript",
        status: "present",
        absenceKind: null,
        supportingContext: null,
        locatedIn: "structured_fields",
        sourceFactIds: [],
      }],
      buriedEvidence: [],
      confidence: "high",
    },
    positioning: {
      atsScreenScore: 80,
      atsReadabilityScore: 85,
      targetAts: "greenhouse",
      atsProfileApplied: "greenhouse",
      resumeTitle: "Software Engineer",
      supportedMissing: [],
      unsupportedMissing: [],
      presentKeywords: ["typescript"],
      leadWith: ["typescript"],
      surfaceFromRawText: [],
      closeGaps: [],
      fieldContext: null,
      repairEstimate: {
        supportedEditCount: 0,
        estimatedMinutes: 10,
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
        observedSubScoreCount: 2,
        healthUsable: true,
        healthComputedAt: "2026-08-13T11:00:00.000Z",
        hiringFreeze: {
          detected: false,
          confidence: null,
          alreadyCountedInGhostRisk: false,
        },
        medianDaysOpen: 20,
        timeToFillSample: 10,
      },
      confidence: "high",
    },
    eligibility: {
      candidate: {
        canWorkForTargetEmployerWithoutNewImmigrationAction: "YES",
        targetEmployerAuthorizationExplanation: "Candidate supplied work authorization facts.",
        declaredVisaStatus: "citizen",
        declaredWorkAuthorization: "us_citizen",
        authorizationEndDate: null,
        futureEmployerActions: [],
        readFrom: ["profiles.visa_status"],
        derivedFromDefaultsOnly: false,
        currentAuthorizationType: "citizen",
      },
      postingRequirements: [],
      sponsorshipHistory: null,
      otherConstraints: [],
      employerActionFeasibility: [],
    },
    accessRoutes: [],
    referralAdvisory: null,
    sourceFacts: [{
      id: "fact-auth",
      kind: "job_description_text",
      basis: "fact",
      confidence: "high",
      key: "authorization",
      value: "begin employment without sponsorship",
      excerpt: "Applicants must be able to begin employment without sponsorship.",
      observedAt: "2026-08-13T11:00:00.000Z",
      computedAt: null,
      explanation: "Posting authorization excerpt.",
      usableBy: ["eligibility"],
    }],
  }
}
