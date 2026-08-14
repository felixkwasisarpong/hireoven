import type { CapabilityAssessment, CapabilityBand, MismatchCorroboration, XRayFinding } from "./types"

/**
 * Corroborations that describe the *shape* of the mismatch — a different lane,
 * a stated bar the candidate is far under, a required credential they have
 * confirmed they lack. Each is a claim about the job and the history, and each
 * can be pointed at.
 *
 * `career_fit_below_floor` is deliberately absent. It is our own weighted sum
 * crossing a threshold we chose, so it can corroborate a mismatch that
 * something else established but must never establish one alone: a low score
 * with no structural reason behind it is far more likely to be a scoring
 * artefact than a candidate in the wrong lane. Sentry is the worked example —
 * an engineering-management posting where a backend candidate scored 26 and was
 * skipped for the right reason entirely by accident.
 */
export const STRUCTURAL_MISMATCH_CORROBORATIONS: readonly MismatchCorroboration[] = [
  "role_family_incompatible",
  "severe_years_shortfall",
  "mandatory_absent_confirmed",
]

export function isStructuralCorroboration(value: MismatchCorroboration): boolean {
  return STRUCTURAL_MISMATCH_CORROBORATIONS.includes(value)
}

/**
 * RE1 eligibility. Two independent corroborations, at least one structural.
 */
export function mismatchIsCorroborated(corroborations: readonly MismatchCorroboration[]): boolean {
  const unique = [...new Set(corroborations)]
  return unique.length >= 2 && unique.some(isStructuralCorroboration)
}
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

  const trackFinding: XRayFinding[] = input.signals.trackExplanation
    ? [{
        id: "cap-career-track",
        statement: input.signals.trackExplanation,
        basis: "inference",
        confidence: "medium",
        impact: corroborations.includes("role_family_incompatible") ? "limiting" : "supporting",
        sourceFactIds: ["job-row", "resume-row"],
        explanation:
          "Career track (individual contributor vs people management) is judged from the posting title and duties " +
          "against titles and descriptions in the resume. It is separate from domain: a backend engineer and an " +
          "engineering manager share a domain but not a track.",
      }]
    : []

  const findings: XRayFinding[] = [
    ...(input.signals.findings ?? []),
    ...trackFinding,
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
