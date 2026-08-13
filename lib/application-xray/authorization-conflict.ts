import {
  AUTHORIZATION_CONFLICT_MATRIX,
  type AuthorizationMatrixColumn,
} from "./authorization-language"
import { confidenceAtLeast, minConfidence } from "./confidence"
import type {
  AuthorizationConflictEvaluation,
  CandidateAuthorizationTimeline,
  EligibilityObservationBand,
  EmployerActionFeasibility,
  PostingAuthorizationRequirement,
  SponsorshipHistorySignal,
  XRayConfidence,
} from "./types"

export function authorizationMatrixColumn(
  candidate: CandidateAuthorizationTimeline,
): AuthorizationMatrixColumn {
  switch (candidate.canWorkForTargetEmployerWithoutNewImmigrationAction) {
    case "YES":
      return candidate.futureEmployerActions.length > 0
        ? "YES_FUTURE_ACTIONS"
        : "YES_NO_FUTURE_ACTIONS"
    case "NEEDS_EMPLOYER_ACTION":
      return "NEEDS_EMPLOYER_ACTION"
    case "NO":
      return "NO"
    case "UNKNOWN":
      return "UNKNOWN"
  }
}

export function evaluateAuthorizationConflicts(input: {
  candidate: CandidateAuthorizationTimeline
  requirements: PostingAuthorizationRequirement[]
}): AuthorizationConflictEvaluation[] {
  const column = authorizationMatrixColumn(input.candidate)
  const candidateDataSufficient =
    !input.candidate.derivedFromDefaultsOnly &&
    input.candidate.canWorkForTargetEmployerWithoutNewImmigrationAction !== "UNKNOWN"

  return input.requirements.map((requirement) => {
    let outcome = AUTHORIZATION_CONFLICT_MATRIX[requirement.category][column]

    if (
      requirement.category === "CITIZENSHIP_REQUIRED" &&
      column === "YES_NO_FUTURE_ACTIONS" &&
      input.candidate.currentAuthorizationType !== "citizen"
    ) {
      outcome = "conflict_now"
    }

    if (
      requirement.category === "CLEARANCE_REQUIRED" &&
      input.candidate.currentAuthorizationType === "citizen" &&
      input.candidate.readFrom.includes("candidate_declaration")
    ) {
      outcome = "no_conflict"
    }

    return {
      requirement,
      outcome,
      explanation: authorizationConflictExplanation(outcome),
      confidence: minConfidence([requirement.confidence, candidateDataSufficient ? "high" : "unknown"]),
      candidateDataSufficient,
    }
  })
}

export function authorizationConflictExplanation(
  outcome: AuthorizationConflictEvaluation["outcome"],
): string {
  switch (outcome) {
    case "conflict_now":
      return "The posting language conflicts with a target-employer action needed before work could start."
    case "conflict_future":
      return "The posting language conflicts with a future employer action the candidate timeline says may be needed."
    case "needs_clarification":
      return "The posting language or the candidate timeline leaves a decision-relevant question open."
    case "no_conflict":
      return "No explicit conflict was found between the posting language and the supplied timeline."
    case "unknown":
      return "The authorization comparison could not be evaluated from the supplied input."
  }
}

export function worstConflict(
  conflicts: AuthorizationConflictEvaluation[],
): AuthorizationConflictEvaluation["outcome"] {
  if (conflicts.some((conflict) => conflict.outcome === "conflict_now")) return "conflict_now"
  if (conflicts.some((conflict) => conflict.outcome === "conflict_future")) return "conflict_future"
  if (conflicts.some((conflict) => conflict.outcome === "needs_clarification")) return "needs_clarification"
  if (conflicts.some((conflict) => conflict.outcome === "unknown")) return "unknown"
  return "no_conflict"
}

export function hasDecisiveConflict(conflicts: AuthorizationConflictEvaluation[]): boolean {
  return conflicts.some(
    (conflict) =>
      (conflict.outcome === "conflict_now" || conflict.outcome === "conflict_future") &&
      conflict.requirement.deterministicMatch &&
      confidenceAtLeast(conflict.confidence, "medium") &&
      conflict.candidateDataSufficient &&
      conflict.requirement.excerpt.trim().length > 0,
  )
}

export function hasRequiredEmployerActionRefusal(
  feasibility: EmployerActionFeasibility[],
): boolean {
  return feasibility.some(
    (item) =>
      item.status === "REFUSED_CONFIRMED" &&
      item.candidateRequiresAction === true &&
      item.employerStatementExcerpt !== null &&
      item.employerStatementExcerpt.trim().length > 0 &&
      item.sourceFactIds.length > 0 &&
      confidenceAtLeast(item.confidence, "medium"),
  )
}

export function resolveEligibilityBand(input: {
  descriptionWasReadable: boolean
  conflicts: AuthorizationConflictEvaluation[]
  candidate: CandidateAuthorizationTimeline
  sponsorshipHistory: SponsorshipHistorySignal | null
  employerActionFeasibility: EmployerActionFeasibility[]
}): EligibilityObservationBand {
  if (!input.descriptionWasReadable) return "UNKNOWN"
  if (hasRequiredEmployerActionRefusal(input.employerActionFeasibility)) {
    return "EXPLICIT_REQUIREMENT_CONFLICT"
  }
  const worst = worstConflict(input.conflicts)
  if (worst === "conflict_now" || worst === "conflict_future") {
    return "EXPLICIT_REQUIREMENT_CONFLICT"
  }
  if (worst === "needs_clarification") return "NEEDS_CLARIFICATION"
  if (
    input.candidate.futureEmployerActions.some(
      (action) => action.status === "REQUIRED" || action.status === "POSSIBLE",
    )
  ) {
    return "EMPLOYER_ACTION_MAY_BE_NEEDED"
  }
  if (input.sponsorshipHistory?.employerHasSponsored !== undefined && input.sponsorshipHistory !== null) {
    if (input.sponsorshipHistory.employerHasSponsored === "unknown") {
      return input.candidate.canWorkForTargetEmployerWithoutNewImmigrationAction === "UNKNOWN"
        ? "UNKNOWN"
        : "EMPLOYER_ACTION_MAY_BE_NEEDED"
    }
  }
  if (input.candidate.canWorkForTargetEmployerWithoutNewImmigrationAction === "UNKNOWN") return "UNKNOWN"
  return "NO_EXPLICIT_CONFLICT_FOUND"
}

export function eligibilityConfidence(input: {
  band: EligibilityObservationBand
  conflicts: AuthorizationConflictEvaluation[]
  fallback?: XRayConfidence
}): XRayConfidence {
  if (input.band === "UNKNOWN") return "unknown"
  if (input.conflicts.length === 0) return input.fallback ?? "medium"
  return minConfidence(input.conflicts.map((conflict) => conflict.confidence))
}
