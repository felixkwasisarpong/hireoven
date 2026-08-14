import type { CapabilityAssessment, CapabilityBand, XRayFinding } from "./types"
import type { CapabilitySignalInput } from "./inputs"

export function assessCapability(input: {
  signals: CapabilitySignalInput
  resumeMissing: boolean
  computedAt: string
}): CapabilityAssessment {
  const requirements = input.signals.requirements
  const corroborations = [...input.signals.mismatchCorroborations].sort()
  if (requirements.some((requirement) => requirement.supportsHardSkip)) {
    if (!corroborations.includes("mandatory_absent_confirmed")) {
      corroborations.push("mandatory_absent_confirmed")
    }
  }

  let band: CapabilityBand
  if (input.resumeMissing || input.signals.careerFitScore === null) {
    band = "UNKNOWN"
  } else if (corroborations.length >= 2) {
    band = "MISMATCH"
  } else if (input.signals.careerFitScore >= 80) {
    band = "EXCEEDS"
  } else if (input.signals.careerFitScore >= 65) {
    band = "MEETS"
  } else if (input.signals.careerFitScore >= 50) {
    band = "NEAR_MISS"
  } else {
    band = "STRETCH"
  }

  const dataGaps: CapabilityAssessment["dataGaps"] = []
  if (band === "UNKNOWN") {
    // Attribute the gap to whoever can actually close it.
    //
    // A readable, parsed resume with no careerFitScore is NOT a candidate
    // problem — it means HireOven has never scored this (resume, job) pair.
    // Telling that candidate to "upload or re-parse a resume" is both wrong and
    // insulting: they did their part, and the missing artefact is ours. It also
    // sends them round a loop that cannot fix anything, because re-uploading
    // does not trigger scoring for this job.
    const resumeUsable = input.signals.resumeReadable === true && !input.resumeMissing
    dataGaps.push(
      resumeUsable
        ? {
            id: "capability-score-not-computed",
            dimension: "capability",
            severity: "dimension_blocking",
            label: "Match score has not been computed for this job",
            missingField: "job_match_scores.score_breakdown.careerFit",
            whyNotDefaulted:
              "The resume is readable. An uncomputed score is a HireOven gap, not evidence about the candidate.",
            resolution: { actor: "hireoven", step: "Recompute the match score for this resume and job." },
          }
        : {
            id: "capability-inputs-missing",
            dimension: "capability",
            severity: "dimension_blocking",
            label: "Capability inputs are missing",
            missingField: "resume or careerFitScore",
            whyNotDefaulted: "A missing resume or score does not mean the candidate lacks capability.",
            resolution: { actor: "candidate", step: "Upload or re-parse a resume." },
          },
    )
  }
  if (!input.signals.requiredYearsStated) {
    dataGaps.push({
      id: "years-requirement-unstated",
      dimension: "capability",
      severity: "cosmetic",
      label: "Years requirement was not stated",
      missingField: "requiredYears",
      whyNotDefaulted: "No stated years requirement means no shortfall can be computed.",
      resolution: null,
    })
  }

  const findings: XRayFinding[] = [
    ...(input.signals.findings ?? []),
    {
      id: "cap-career-fit",
      statement: capabilityStatement(band),
      basis: "inference",
      confidence: input.signals.confidence ?? (band === "UNKNOWN" ? "unknown" : "medium"),
      impact: band === "MISMATCH" || band === "STRETCH" ? "limiting" : band === "UNKNOWN" ? "unknown" : "supporting",
      sourceFactIds: [],
      explanation: "Capability uses careerFitScore and corroborated mismatch signals, not the blended feed score.",
    },
  ]

  return {
    band,
    confidence: input.signals.confidence ?? (band === "UNKNOWN" ? "unknown" : "medium"),
    headline: capabilityStatement(band),
    findings,
    dataGaps,
    oldestInputObservedAt: null,
    computedAt: input.computedAt,
    staleInputsDowngraded: false,
    careerFitScore: input.signals.careerFitScore,
    careerFitLabel: input.signals.careerFitLabel,
    relevantYears: input.signals.relevantYears,
    totalYears: input.signals.totalYears,
    requiredYears: input.signals.requiredYearsStated ? input.signals.requiredYears : null,
    requiredYearsStated: input.signals.requiredYearsStated,
    relevantYearsRatio: input.signals.requiredYearsStated ? input.signals.relevantYearsRatio : null,
    roleFamily: input.signals.roleFamily,
    candidateRoleFamilies: [...input.signals.candidateRoleFamilies].sort(),
    roleFamilyCompatible: input.signals.roleFamilyCompatible,
    requirements,
    mismatchCorroborationCount: corroborations.length,
    mismatchCorroborations: corroborations,
    overqualification: input.signals.overqualification ?? {
      detected: false,
      seniorityGap: null,
      note: null,
    },
  }
}

function capabilityStatement(band: CapabilityBand): string {
  switch (band) {
    case "EXCEEDS":
      return "The supplied career-fit evidence is stronger than this role's baseline."
    case "MEETS":
      return "The supplied career-fit evidence meets this role's baseline."
    case "NEAR_MISS":
      return "The supplied career-fit evidence is close, with some gaps to inspect."
    case "STRETCH":
      return "The supplied career-fit evidence makes this a stretch."
    case "MISMATCH":
      return "Multiple capability signals point away from this role."
    case "UNKNOWN":
      return "Capability cannot be assessed from the supplied inputs."
  }
}
