import assert from "node:assert/strict"
import test from "node:test"
import {
  hasAcquirableAbsentRequirement,
  normalizeRequirementForDecision,
  requirementSupportsHardSkip,
} from "./requirements"
import type {
  AcquirabilitySource,
  EvaluatedRequirement,
  RequirementAcquirability,
  RequirementPresence,
  RequirementStrength,
  RequirementStrengthProvenance,
} from "./types"

test("NOT_FOUND and UNKNOWN can never support a hard skip", () => {
  const strengths: RequirementStrength[] = ["MANDATORY_EXPLICIT", "PREFERRED_EXPLICIT", "INFERRED", "UNKNOWN"]
  const provenances: RequirementStrengthProvenance[] = [
    "deterministic_pattern",
    "structured_ats_field",
    "section_header_plus_pattern",
    "llm_only",
    "none",
  ]
  const acquirabilitySources: AcquirabilitySource[] = ["candidate_declared", "credential_catalog", "unknown"]
  let assertions = 0

  for (const presence of ["NOT_FOUND", "UNKNOWN"] satisfies RequirementPresence[]) {
    for (const strength of strengths) {
      for (const strengthProvenance of provenances) {
        for (const acquirabilitySource of acquirabilitySources) {
          assert.equal(
            requirementSupportsHardSkip({
              strength,
              strengthProvenance,
              presence,
              contradictionReliability: null,
              acquirabilitySource,
              acquirabilityEstimatedDays: 3,
              opportunityWindowDays: 30,
            }),
            false,
            `${presence}/${strength}/${strengthProvenance}/${acquirabilitySource}`,
          )
          assertions += 1
        }
      }
    }
  }

  assert.equal(assertions, 120)
})

test("LLM-only mandatory requirements are downgraded to inferred", () => {
  const normalized = normalizeRequirementForDecision(
    requirement({
      strength: "MANDATORY_EXPLICIT",
      strengthProvenance: "llm_only",
      presence: "ABSENT_CONFIRMED",
    }),
    30,
  )

  assert.equal(normalized.strength, "INFERRED")
  assert.equal(normalized.supportsHardSkip, false)
})

test("candidate-confirmed absence can hard skip only when not acquirable inside the window", () => {
  const absent = normalizeRequirementForDecision(
    requirement({ presence: "ABSENT_CONFIRMED", acquirability: { source: "unknown", estimatedDays: null } }),
    30,
  )
  const inWindow = normalizeRequirementForDecision(
    requirement({
      presence: "ABSENT_CONFIRMED",
      acquirability: { source: "candidate_declared", estimatedDays: 10 },
    }),
    30,
  )
  const outOfWindow = normalizeRequirementForDecision(
    requirement({
      presence: "ABSENT_CONFIRMED",
      acquirability: { source: "candidate_declared", estimatedDays: 60 },
    }),
    30,
  )

  assert.equal(absent.supportsHardSkip, true)
  assert.equal(inWindow.supportsHardSkip, false)
  assert.equal(hasAcquirableAbsentRequirement([inWindow]), true)
  assert.equal(outOfWindow.supportsHardSkip, true)
  assert.equal(hasAcquirableAbsentRequirement([outOfWindow]), false)
})

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
    sourceFactIds: ["fact-cpa"],
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
