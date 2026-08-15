import { validAccessRoutes } from "./access-routes"
import { evaluateAuthorizationConflicts, eligibilityConfidence, resolveEligibilityBand } from "./authorization-conflict"
import { assessCapability } from "./capability"
import { resolveCanonicalJob } from "./canonical-resolution"
import { assessPosting } from "./assessability"
import { decideApplicationXRay } from "./decision-engine"
import { assessEvidence } from "./evidence"
import { assessHiringReality } from "./hiring-reality"
import type { ApplicationXRayInput } from "./inputs"
import { xrayToApplicationVerdict } from "./legacy-adapter"
import { assessPositioning } from "./positioning"
import { normalizeRequirementForDecision } from "./requirements"
import { stableHash } from "./stable"
import {
  APPLICATION_XRAY_SCHEMA_VERSION,
  type ApplicationXRay,
  type EligibilityAssessment,
  type EmployerActionFeasibility,
  type EvaluatedRequirement,
  type PostingAuthorizationRequirement,
  type XRayDataGap,
  type XRayFinding,
  type XRaySourceFact,
} from "./types"

export function scoreApplicationXRay(input: ApplicationXRayInput): ApplicationXRay {
  const computedAt = input.now
  const canonicalResult = resolveCanonicalJob(input)
  const evaluatedJob = canonicalResult.evaluatedJob
  const opportunityWindowDays = opportunityWindowDaysFromAge(evaluatedJob?.availability.ageDays ?? null)
  const requirements = sortRequirements(
    input.capability.requirements.map((requirement) =>
      normalizeRequirementForDecision(requirement, opportunityWindowDays),
    ),
  )

  const hiringReality = assessHiringReality({
    availability: evaluatedJob?.availability ?? null,
    signals: input.hiringReality,
    computedAt,
    canonicalUnresolved: canonicalResult.canonical.outcome.startsWith("unresolved_"),
  })

  const capability = assessCapability({
    signals: { ...input.capability, requirements },
    resumeMissing: input.resume === null,
    computedAt,
  })

  const evidence = assessEvidence({
    resume: input.resume,
    signals: input.evidence,
    capabilityBand: capability.band,
    computedAt,
  })

  const eligibility = assessEligibility({
    descriptionWasReadable: evaluatedJob?.descriptionReadable ?? false,
    input,
    computedAt,
  })

  const positioning = assessPositioning({
    signals: input.positioning,
    jobTitle: evaluatedJob?.title ?? "",
    computedAt,
  })

  const accessRoutes = validAccessRoutes(input.accessRoutes)
  const dataGaps = sortDataGaps([
    ...(input.dataGaps ?? []),
    ...(canonicalResult.dataGap ? [canonicalResult.dataGap] : []),
    ...hiringReality.dataGaps,
    ...capability.dataGaps,
    ...evidence.dataGaps,
    ...eligibility.dataGaps,
    ...positioning.dataGaps,
  ])
  const sourceFacts = sortSourceFacts(input.sourceFacts ?? [])

  const undecided: ApplicationXRay = {
    schemaVersion: APPLICATION_XRAY_SCHEMA_VERSION,
    computedAt,
    inputsHash: stableHash(input),
    canonical: canonicalResult.canonical,
    evaluatedJobId: canonicalResult.canonical.evaluatedJobId,
    requestedJobId: input.requestedJobId,
    companyId: evaluatedJob?.companyId ?? null,
    userId: input.userId,
    resumeId: input.resume?.id ?? null,
    resumeVersion: input.resume?.version ?? null,
    hiringReality,
    capability,
    evidence,
    eligibility,
    positioning,
    accessRoutes,
    referralAdvisory: input.referralAdvisory,
    rejectionRisks: [],
    actions: [],
    finalAction: "INSUFFICIENT_DATA",
    confidence: "unknown",
    headline: "Not enough to judge",
    decisionTrace: {
      engineVersion: "application-xray-core-2026-08-13.1",
      evaluated: [],
      selectedStage: "D_sufficiency",
      selectedRuleId: "RD1",
      suppressedRuleIds: [],
      tieBreak: null,
    },
    dataGaps,
    sourceFacts,
    summary: {
      finalAction: "INSUFFICIENT_DATA",
      confidence: "unknown",
      bands: {
        hiringReality: hiringReality.band,
        capability: capability.band,
        evidence: evidence.band,
        eligibility: eligibility.band,
        positioning: positioning.band,
      },
      topRiskId: null,
      resolvedFromDuplicate: canonicalResult.canonical.outcome === "resolved",
      computedAt,
    },
    legacyVerdictProjection: null,
  }

  // Stage B0: can this posting be assessed at all? Computed here so the
  // decision engine stays pure and the verdict rides in the context.
  const evaluatedRecord =
    input.jobRecords.find((record) => record.id === undecided.evaluatedJobId) ?? input.jobRecords[0] ?? null
  const assessability = assessPosting({
    title: evaluatedRecord?.title ?? null,
    description: evaluatedRecord?.descriptionText ?? null,
    applyUrl: evaluatedRecord?.applyUrl ?? null,
    externalId: evaluatedRecord?.externalId ?? null,
    ageDays: evaluatedRecord?.availability.ageDays ?? null,
    applyUrlStatus: evaluatedRecord?.availability.applyUrlStatus ?? "unknown",
    lastSeenAt: evaluatedRecord?.availability.lastSeenAt ?? null,
    lastSeenAtTrustworthy: evaluatedRecord?.availability.lastSeenAtTrustworthy ?? false,
    now: input.now,
  })

  const decision = decideApplicationXRay({ ...undecided, dataGaps, assessability })
  const decided: ApplicationXRay = {
    ...undecided,
    rejectionRisks: decision.rejectionRisks,
    actions: decision.actions,
    finalAction: decision.finalAction,
    confidence: decision.confidence,
    headline: decision.headline,
    decisionTrace: decision.trace,
    summary: {
      ...undecided.summary,
      finalAction: decision.finalAction,
      confidence: decision.confidence,
      topRiskId: decision.rejectionRisks[0]?.id ?? null,
    },
  }

  return {
    ...decided,
    legacyVerdictProjection: xrayToApplicationVerdict(decided),
  }
}

function assessEligibility(input: {
  descriptionWasReadable: boolean
  input: ApplicationXRayInput
  computedAt: string
}): EligibilityAssessment {
  const postingRequirements = sortPostingRequirements(input.input.eligibility.postingRequirements)
  const employerActionFeasibility = sortEmployerActionFeasibility(input.input.eligibility.employerActionFeasibility)
  const conflicts = evaluateAuthorizationConflicts({
    candidate: input.input.eligibility.candidate,
    requirements: postingRequirements,
  })
  const band = resolveEligibilityBand({
    descriptionWasReadable: input.descriptionWasReadable,
    conflicts,
    candidate: input.input.eligibility.candidate,
    sponsorshipHistory: input.input.eligibility.sponsorshipHistory,
    employerActionFeasibility,
  })
  const findings: XRayFinding[] = [
    ...(input.input.eligibility.findings ?? []),
    {
      id: "eligibility-observation",
      statement: eligibilityStatement(band),
      basis: "fact",
      confidence: input.input.eligibility.confidence ?? eligibilityConfidence({ band, conflicts }),
      impact: band === "EXPLICIT_REQUIREMENT_CONFLICT" ? "limiting" : band === "NO_EXPLICIT_CONFLICT_FOUND" ? "supporting" : "neutral",
      sourceFactIds: postingRequirements.map((requirement) => requirement.sourceFactId),
      explanation: "Eligibility is an observational comparison of supplied candidate facts, posting language, and employer-action feasibility.",
    },
  ]
  const dataGaps = eligibilityDataGaps({
    descriptionWasReadable: input.descriptionWasReadable,
    postingRequirements,
    candidateUnknown: input.input.eligibility.candidate.canWorkForTargetEmployerWithoutNewImmigrationAction === "UNKNOWN" ||
      input.input.eligibility.candidate.derivedFromDefaultsOnly,
    employerActionFeasibility,
    band,
  })

  return {
    band,
    confidence: input.input.eligibility.confidence ?? eligibilityConfidence({ band, conflicts, fallback: "medium" }),
    headline: eligibilityStatement(band),
    findings,
    dataGaps,
    oldestInputObservedAt: null,
    computedAt: input.computedAt,
    staleInputsDowngraded: false,
    candidate: input.input.eligibility.candidate,
    postingRequirements,
    descriptionWasReadable: input.descriptionWasReadable,
    conflicts,
    employerActionFeasibility,
    sponsorshipHistory: input.input.eligibility.sponsorshipHistory,
    otherConstraints: [...input.input.eligibility.otherConstraints].sort((a, b) =>
      a.kind.localeCompare(b.kind) || a.statement.localeCompare(b.statement),
    ),
    disclaimerRequired: true,
  }
}

function eligibilityDataGaps(input: {
  descriptionWasReadable: boolean
  postingRequirements: PostingAuthorizationRequirement[]
  candidateUnknown: boolean
  employerActionFeasibility: EmployerActionFeasibility[]
  band: EligibilityAssessment["band"]
}): XRayDataGap[] {
  const gaps: XRayDataGap[] = []
  if (!input.descriptionWasReadable) {
    gaps.push({
      id: "posting-authorization-language-unreadable",
      dimension: "eligibility",
      severity: "dimension_blocking",
      label: "Posting authorization language could not be read",
      missingField: "job description text",
      whyNotDefaulted: "Unreadable posting text cannot prove the absence of authorization restrictions.",
      resolution: { actor: "hireoven", step: "Re-read the employer posting or supply structured authorization language." },
    })
  }
  if (input.candidateUnknown) {
    gaps.push({
      id: "candidate-authorization-timeline-unknown",
      dimension: "eligibility",
      severity: "decision_relevant",
      label: "Candidate authorization timeline is unknown",
      missingField: "candidate authorization declaration",
      whyNotDefaulted: "Schema defaults are not evidence of work authorization.",
      resolution: { actor: "candidate", step: "Complete the target-employer work authorization timeline." },
    })
  }
  if (input.postingRequirements.some((requirement) => requirement.category === "SPONSORSHIP_SCOPE_AMBIGUOUS")) {
    gaps.push({
      id: "sponsorship-scope-unstated",
      dimension: "eligibility",
      severity: "decision_relevant",
      label: "Sponsorship scope is unstated",
      missingField: "posting sponsorship time scope",
      whyNotDefaulted: "A generic no-sponsorship sentence does not say whether future employer actions are barred.",
      resolution: { actor: "employer", step: "Confirm whether the sponsorship statement applies to future employer actions." },
    })
  }
  if (input.postingRequirements.some((requirement) => requirement.category === "AMBIGUOUS_GENERAL")) {
    gaps.push({
      id: "posting-authorization-language-ambiguous",
      dimension: "eligibility",
      severity: "decision_relevant",
      label: "Posting authorization wording is ambiguous",
      missingField: "explicit work authorization scope",
      whyNotDefaulted: "General authorization boilerplate does not identify the candidate-specific constraint.",
      resolution: { actor: "candidate", step: "Confirm the target-employer authorization timeline." },
    })
  }
  for (const item of input.employerActionFeasibility) {
    if (item.actionType === "STEM_OPT_EVERIFY_PARTICIPATION" && item.status === "UNKNOWN") {
      gaps.push({
        id: "everify-participation-unknown",
        dimension: "eligibility",
        severity: "decision_relevant",
        label: "E-Verify participation is unknown",
        missingField: "employer E-Verify participation",
        whyNotDefaulted: "Unknown employer participation is not confirmed non-enrolment.",
        resolution: { actor: "employer", step: "Confirm whether the employer participates in E-Verify." },
      })
    }
    if (item.actionType === "STEM_OPT_EVERIFY_PARTICIPATION" && item.status === "NOT_FOUND") {
      gaps.push({
        id: "everify-source-coverage",
        dimension: "eligibility",
        severity: "decision_relevant",
        label: "Employer was not found in an E-Verify source",
        missingField: "confirmed E-Verify participation",
        whyNotDefaulted: "A miss in an incomplete source is not a direct employer refusal.",
        resolution: { actor: "employer", step: "Confirm E-Verify participation with the employer." },
      })
    }
    if (item.status === "REFUSED_CONFIRMED" && item.candidateRequiresAction === "unknown") {
      gaps.push({
        id: "required-employer-action-need-unconfirmed",
        dimension: "eligibility",
        severity: "decision_relevant",
        label: "Candidate need for the refused employer action is unconfirmed",
        missingField: "candidate-required employer action declaration",
        whyNotDefaulted: "Employer refusal matters decisively only if the candidate confirms the action is required for this job.",
        resolution: { actor: "candidate", step: "Confirm whether this employer action is required for the target job." },
      })
    }
  }
  if (input.band === "EMPLOYER_ACTION_MAY_BE_NEEDED") {
    gaps.push({
      id: "role-specific-sponsorship-unknown",
      dimension: "eligibility",
      severity: "decision_relevant",
      label: "Role-specific employer action policy is unknown",
      missingField: "role-specific sponsorship or employer-action statement",
      whyNotDefaulted: "Employer history and future-action timelines are not promises for this role.",
      resolution: { actor: "employer", step: "Confirm the role-specific policy before relying on history." },
    })
  }
  return sortDataGaps(gaps)
}

function opportunityWindowDaysFromAge(ageDays: number | null): number | null {
  if (ageDays === null || !Number.isFinite(ageDays)) return 45
  return Math.max(0, 45 - ageDays)
}

function eligibilityStatement(band: EligibilityAssessment["band"]): string {
  switch (band) {
    case "NO_EXPLICIT_CONFLICT_FOUND":
      return "No explicit authorization conflict was found in the supplied facts."
    case "EMPLOYER_ACTION_MAY_BE_NEEDED":
      return "The supplied timeline indicates an employer action may be needed."
    case "NEEDS_CLARIFICATION":
      return "Authorization wording or candidate timeline details need clarification."
    case "EXPLICIT_REQUIREMENT_CONFLICT":
      return "A cited posting or employer statement conflicts with supplied candidate facts."
    case "UNKNOWN":
      return "Authorization cannot be assessed from the supplied inputs."
  }
}

function sortRequirements(requirements: EvaluatedRequirement[]): EvaluatedRequirement[] {
  return [...requirements].sort((a, b) => a.id.localeCompare(b.id))
}

function sortPostingRequirements(requirements: PostingAuthorizationRequirement[]): PostingAuthorizationRequirement[] {
  return [...requirements].sort((a, b) =>
    a.category.localeCompare(b.category) ||
    a.sourceFactId.localeCompare(b.sourceFactId) ||
    a.excerpt.localeCompare(b.excerpt),
  )
}

function sortEmployerActionFeasibility(items: EmployerActionFeasibility[]): EmployerActionFeasibility[] {
  return [...items].sort((a, b) =>
    a.actionType.localeCompare(b.actionType) ||
    a.status.localeCompare(b.status) ||
    (a.employerStatementExcerpt ?? "").localeCompare(b.employerStatementExcerpt ?? ""),
  )
}

function sortDataGaps(gaps: XRayDataGap[]): XRayDataGap[] {
  return [...gaps].sort((a, b) => a.id.localeCompare(b.id))
}

function sortSourceFacts(facts: XRaySourceFact[]): XRaySourceFact[] {
  return [...facts].sort((a, b) => a.id.localeCompare(b.id))
}
