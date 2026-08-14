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

/**
 * MISALIGNED is an accusation about a document, so it requires positive,
 * source-backed evidence — never the mere absence of an input.
 *
 * Previously a null ATS score (nothing had scored the pair) combined with an
 * empty keyword set could reach MISALIGNED through the requiresNewEvidence
 * branch, and the corpus being unavailable had the same effect. That is the
 * unknown-becomes-negative failure the contract forbids, and it is especially
 * unfair here: it tells someone their resume is aimed at the wrong job on the
 * strength of a cache miss.
 */
function hasPositiveMisalignmentEvidence(input: PositioningSignalInput): boolean {
  const scoreAvailable = input.atsScreenScoreAvailable !== false && input.atsScreenScore !== null
  // Evidence 1: a computed screen score that is genuinely low.
  if (scoreAvailable && (input.atsScreenScore as number) < 55) return true
  // Evidence 2: the posting's terms were extracted, and the resume supports
  // almost none of them while needing new evidence for the rest.
  const termsExtracted = input.unsupportedMissing.length + input.supportedMissing.length + input.presentKeywords.length
  if (
    termsExtracted > 0 &&
    input.repairEstimate.requiresNewEvidence &&
    input.unsupportedMissing.length > input.supportedMissing.length &&
    input.presentKeywords.length === 0
  ) {
    return true
  }
  return false
}

function inferBand(input: PositioningSignalInput): PositioningBand {
  const scoreAvailable = input.atsScreenScoreAvailable !== false && input.atsScreenScore !== null
  const termsExtracted =
    input.unsupportedMissing.length + input.supportedMissing.length + input.presentKeywords.length

  // Nothing to reason from: no computed score AND no extracted posting terms.
  // Widen to UNKNOWN rather than inventing a verdict.
  if (!scoreAvailable && termsExtracted === 0) {
    return "UNKNOWN"
  }
  if (hasPositiveMisalignmentEvidence(input)) {
    return "MISALIGNED"
  }
  if (input.supportedMissing.length > 0 || input.surfaceFromRawText.length > 0) {
    return "TUNABLE"
  }
  // An ALIGNED claim also needs something behind it. With no computed score we
  // can say the keywords are covered, not that the document is well aimed.
  if (!scoreAvailable) {
    return "UNKNOWN"
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
