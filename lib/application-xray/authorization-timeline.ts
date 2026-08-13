import type {
  CandidateAuthorizationTimeline,
  FutureEmployerAction,
  FutureEmployerActionType,
  TargetEmployerWorkAuthorization,
  VisaStatus,
  WorkAuthorization,
} from "./types"

export type CandidateAuthorizationTimelineInput = {
  visaStatus: VisaStatus | null
  workAuthorization: WorkAuthorization | null
  authorizationEndDate: string | null
  roleRelatedToDegree: boolean | "unknown"
  stemDegreeEligible: boolean | "unknown"
  derivedFromDefaultsOnly: boolean
  readFrom: CandidateAuthorizationTimeline["readFrom"]
}

export function buildCandidateAuthorizationTimeline(
  input: CandidateAuthorizationTimelineInput,
): CandidateAuthorizationTimeline {
  if (
    input.derivedFromDefaultsOnly ||
    (!input.visaStatus && !input.workAuthorization)
  ) {
    return timeline(input, "UNKNOWN", [], "No explicit work-authorization facts were supplied.", "unknown")
  }

  if (input.workAuthorization === "us_citizen" || input.visaStatus === "citizen") {
    return timeline(input, "YES", [], "Candidate declared U.S. citizenship.", "citizen")
  }

  if (input.workAuthorization === "green_card" || input.visaStatus === "green_card") {
    return timeline(input, "YES", [], "Candidate declared permanent work authorization.", "green_card")
  }

  if (input.workAuthorization === "require_sponsorship" || input.visaStatus === "other") {
    return timeline(
      input,
      input.workAuthorization === "require_sponsorship" ? "NO" : "UNKNOWN",
      [futureAction("H1B_PETITION", null, "candidate status", "POSSIBLE", "derived_from_status")],
      "Candidate supplied a status that does not establish target-employer authorization.",
      input.visaStatus === "other" ? "unknown" : "temporary_status",
    )
  }

  if (input.visaStatus === "opt" || input.workAuthorization === "opt") {
    const roleRelated = input.roleRelatedToDegree === true
    const futureStatus = input.stemDegreeEligible === "unknown" ? "UNKNOWN" : "POSSIBLE"
    return timeline(
      input,
      roleRelated ? "YES" : "UNKNOWN",
      [
        futureAction("STEM_OPT_EVERIFY_PARTICIPATION", null, "OPT timeline", futureStatus, "derived_from_status"),
        futureAction("STEM_OPT_I983", null, "OPT timeline", futureStatus, "derived_from_status"),
        futureAction("H1B_PETITION", null, "OPT timeline", "POSSIBLE", "derived_from_status"),
      ],
      roleRelated
        ? "Initial OPT can authorize work for the target employer now; later employer actions may still be needed."
        : "Initial OPT target-employer authorization depends on role relation to the degree.",
      "temporary_status",
    )
  }

  if (input.visaStatus === "stem_opt" || input.workAuthorization === "stem_opt") {
    return timeline(
      input,
      "NEEDS_EMPLOYER_ACTION",
      [
        futureAction("STEM_OPT_EVERIFY_PARTICIPATION", 0, "STEM OPT employer participation", "REQUIRED", "derived_from_status"),
        futureAction("STEM_OPT_I983", 0, "STEM OPT training plan", "REQUIRED", "derived_from_status"),
        futureAction("H1B_PETITION", null, "post-STEM OPT path", "POSSIBLE", "derived_from_status"),
      ],
      "STEM OPT requires target-employer E-Verify participation and I-983 completion.",
      "temporary_status",
    )
  }

  if (input.visaStatus === "h1b" || input.workAuthorization === "h1b") {
    return timeline(
      input,
      "NEEDS_EMPLOYER_ACTION",
      [futureAction("H1B_TRANSFER", 0, "new target employer", "REQUIRED", "derived_from_status")],
      "H-1B authorization is employer-specific; a target-employer transfer is required.",
      "temporary_status",
    )
  }

  if (input.workAuthorization === "tn_visa") {
    return timeline(
      input,
      "NEEDS_EMPLOYER_ACTION",
      [futureAction("OTHER", 0, "new target employer", "REQUIRED", "derived_from_status")],
      "TN work authorization is employer-specific.",
      "temporary_status",
    )
  }

  return timeline(input, "UNKNOWN", [futureAction("UNKNOWN", null, "unknown status", "UNKNOWN", "unknown")], "The supplied status could not be mapped deterministically.", "unknown")
}

function timeline(
  input: CandidateAuthorizationTimelineInput,
  canWork: TargetEmployerWorkAuthorization,
  futureEmployerActions: FutureEmployerAction[],
  explanation: string,
  currentAuthorizationType: CandidateAuthorizationTimeline["currentAuthorizationType"],
): CandidateAuthorizationTimeline {
  return {
    canWorkForTargetEmployerWithoutNewImmigrationAction: canWork,
    targetEmployerAuthorizationExplanation: explanation,
    declaredVisaStatus: input.visaStatus,
    declaredWorkAuthorization: input.workAuthorization,
    authorizationEndDate: input.authorizationEndDate,
    futureEmployerActions: futureEmployerActions.sort(
      (a, b) => (a.horizonDays ?? Number.MAX_SAFE_INTEGER) - (b.horizonDays ?? Number.MAX_SAFE_INTEGER) || a.type.localeCompare(b.type),
    ),
    readFrom: [...input.readFrom].sort() as CandidateAuthorizationTimeline["readFrom"],
    derivedFromDefaultsOnly: input.derivedFromDefaultsOnly,
    currentAuthorizationType,
  }
}

function futureAction(
  type: FutureEmployerActionType,
  horizonDays: number | null,
  horizonBasis: string,
  status: FutureEmployerAction["status"],
  source: FutureEmployerAction["source"],
): FutureEmployerAction {
  return {
    type,
    horizonDays,
    horizonBasis,
    status,
    source,
    confidence: status === "UNKNOWN" ? "unknown" : "medium",
    dataGapIds: status === "UNKNOWN" ? ["future-employer-action-unknown"] : [],
    explanation: `${type} is ${status.toLowerCase()} from the supplied authorization timeline.`,
  }
}
