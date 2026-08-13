import type {
  AcquirabilitySource,
  ContradictionReliability,
  EvaluatedRequirement,
  RequirementPresence,
  RequirementStrength,
  RequirementStrengthProvenance,
} from "./types"

export type RequirementHardSkipInput = {
  strength: RequirementStrength
  strengthProvenance: RequirementStrengthProvenance
  presence: RequirementPresence
  contradictionReliability: ContradictionReliability | null
  acquirabilitySource: AcquirabilitySource
  acquirabilityEstimatedDays: number | null
  opportunityWindowDays: number | null
}

export function requirementSupportsHardSkip(input: RequirementHardSkipInput): boolean {
  if (input.strength !== "MANDATORY_EXPLICIT") return false
  if (input.strengthProvenance === "llm_only" || input.strengthProvenance === "none") return false

  const absenceIsEstablished =
    input.presence === "ABSENT_CONFIRMED" ||
    (input.presence === "CONTRADICTED" &&
      input.contradictionReliability === "declaration_vs_structured_field")
  if (!absenceIsEstablished) return false

  if (
    input.acquirabilitySource === "candidate_declared" &&
    typeof input.acquirabilityEstimatedDays === "number" &&
    Number.isFinite(input.acquirabilityEstimatedDays) &&
    typeof input.opportunityWindowDays === "number" &&
    Number.isFinite(input.opportunityWindowDays) &&
    input.acquirabilityEstimatedDays <= input.opportunityWindowDays
  ) {
    return false
  }

  return true
}

export function normalizeRequirementForDecision(
  requirement: EvaluatedRequirement,
  opportunityWindowDays: number | null,
): EvaluatedRequirement {
  const strength =
    requirement.strengthProvenance === "llm_only" && requirement.strength === "MANDATORY_EXPLICIT"
      ? "INFERRED"
      : requirement.strength
  const normalized: EvaluatedRequirement = {
    ...requirement,
    strength,
  }
  return {
    ...normalized,
    supportsHardSkip: requirementSupportsHardSkip({
      strength: normalized.strength,
      strengthProvenance: normalized.strengthProvenance,
      presence: normalized.presence,
      contradictionReliability: normalized.contradictionReliability,
      acquirabilitySource: normalized.acquirability.source,
      acquirabilityEstimatedDays: normalized.acquirability.estimatedDays,
      opportunityWindowDays,
    }),
  }
}

export function hasUnconfirmedMandatoryRequirement(requirements: EvaluatedRequirement[]): boolean {
  return requirements.some(
    (requirement) =>
      requirement.strength === "MANDATORY_EXPLICIT" &&
      (requirement.presence === "NOT_FOUND" || requirement.presence === "UNKNOWN"),
  )
}

export function hasAcquirableAbsentRequirement(requirements: EvaluatedRequirement[]): boolean {
  return requirements.some(
    (requirement) =>
      requirement.strength === "MANDATORY_EXPLICIT" &&
      requirement.presence === "ABSENT_CONFIRMED" &&
      requirement.supportsHardSkip === false &&
      requirement.acquirability.source !== "unknown" &&
      typeof requirement.acquirability.estimatedDays === "number",
  )
}
