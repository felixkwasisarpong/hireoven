import type { PositioningAssessment, PositioningBand } from "./types"
import type { PositioningSignalInput } from "./inputs"

export function assessPositioning(input: {
  signals: PositioningSignalInput
  jobTitle: string
  computedAt: string
}): PositioningAssessment {
  const band = input.signals.bandHint ?? inferBand(input.signals)
  const dataGaps: PositioningAssessment["dataGaps"] = []
  if (band === "UNKNOWN") {
    dataGaps.push({
      id: "positioning-inputs-missing",
      dimension: "positioning",
      severity: "decision_relevant",
      label: "Positioning inputs are missing",
      missingField: "tailor analysis or ATS screen score",
      whyNotDefaulted: "Missing positioning data is not a score of zero.",
      resolution: { actor: "hireoven", step: "Run deterministic tailoring analysis for this job." },
    })
  }
  if (input.signals.fieldContext && !input.signals.fieldContext.corpusAvailable) {
    dataGaps.push({
      id: "field-corpus-unavailable",
      dimension: "positioning",
      severity: "cosmetic",
      label: "Field corpus data is unavailable",
      missingField: "field_skill_profiles",
      whyNotDefaulted: "An unavailable corpus cannot be read as zero field fit.",
      resolution: { actor: "hireoven", step: "Refresh field profiles." },
    })
  }

  return {
    band,
    confidence: input.signals.confidence ?? (band === "UNKNOWN" ? "unknown" : "medium"),
    headline: positioningStatement(band),
    findings: input.signals.findings ?? [],
    dataGaps,
    oldestInputObservedAt: null,
    computedAt: input.computedAt,
    staleInputsDowngraded: false,
    atsScreenScore: input.signals.atsScreenScore,
    atsReadabilityScore: input.signals.atsReadabilityScore,
    targetAts: input.signals.targetAts,
    atsProfileApplied: input.signals.atsProfileApplied,
    titleAlignment: {
      resumeTitle: input.signals.resumeTitle,
      jobTitle: input.jobTitle,
      mirrorsJobTitle: input.signals.resumeTitle
        ? input.signals.resumeTitle.trim().toLowerCase() === input.jobTitle.trim().toLowerCase()
        : "unknown",
    },
    supportedMissing: [...input.signals.supportedMissing].sort(),
    unsupportedMissing: [...input.signals.unsupportedMissing].sort(),
    presentKeywords: [...input.signals.presentKeywords].sort(),
    leadWith: [...input.signals.leadWith].sort(),
    surfaceFromRawText: [...input.signals.surfaceFromRawText].sort(),
    closeGaps: [...input.signals.closeGaps].sort(),
    fieldContext: input.signals.fieldContext,
    repairEstimate: input.signals.repairEstimate,
  }
}

function inferBand(input: PositioningSignalInput): PositioningBand {
  if (input.atsScreenScore === null && input.supportedMissing.length === 0 && input.unsupportedMissing.length === 0) {
    return "UNKNOWN"
  }
  if (input.repairEstimate.requiresNewEvidence && input.unsupportedMissing.length > input.supportedMissing.length) {
    return "MISALIGNED"
  }
  if (input.supportedMissing.length > 0 || input.surfaceFromRawText.length > 0) {
    return "TUNABLE"
  }
  if (input.atsScreenScore !== null && input.atsScreenScore < 55) {
    return "MISALIGNED"
  }
  return "ALIGNED"
}

function positioningStatement(band: PositioningBand): string {
  switch (band) {
    case "ALIGNED":
      return "The resume is aimed at this role."
    case "TUNABLE":
      return "The resume can be tuned with evidence already present."
    case "MISALIGNED":
      return "The resume appears aimed at a different role."
    case "UNKNOWN":
      return "Positioning cannot be assessed from the supplied inputs."
  }
}
