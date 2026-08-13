import type { EvidenceBand, EvidenceStrengthAssessment } from "./types"
import type { ApplicationXRayResumeInput, EvidenceSignalInput } from "./inputs"

export function assessEvidence(input: {
  resume: ApplicationXRayResumeInput | null
  signals: EvidenceSignalInput
  capabilityBand: "EXCEEDS" | "MEETS" | "NEAR_MISS" | "STRETCH" | "MISMATCH" | "UNKNOWN"
  computedAt: string
}): EvidenceStrengthAssessment {
  const legibility = {
    parseStatus: input.resume?.parseStatus ?? "absent",
    parseError: input.resume?.parseError ?? null,
    datedRoleCount: input.resume?.datedRoleCount ?? 0,
    hasRawText: input.resume?.hasRawText ?? false,
    blocksAssessment:
      !input.resume ||
      input.resume.parseStatus === "failed" ||
      !input.resume.hasRawText ||
      input.resume.datedRoleCount === 0,
  } as const

  const coverage = coverageFromSupport(input.signals.requirementSupport)
  let band: EvidenceBand
  if (legibility.blocksAssessment || coverage.requiredTermCount === 0) {
    band = "UNREADABLE"
  } else if (
    (input.capabilityBand === "MEETS" || input.capabilityBand === "EXCEEDS") &&
    input.signals.buriedEvidence.length > 0 &&
    coverage.presentRatio !== null &&
    coverage.presentRatio < 0.7
  ) {
    band = "BURIED"
  } else if (
    coverage.presentRatio !== null &&
    coverage.presentRatio >= 0.7 &&
    coverage.confirmedAbsentCount === 0
  ) {
    band = "STRONG"
  } else if (
    coverage.presentRatio !== null &&
    coverage.presentRatio >= 0.5 &&
    coverage.supportedCount >= coverage.notFoundCount
  ) {
    band = "ADEQUATE"
  } else if (coverage.notFoundCount > coverage.presentCount) {
    band = "THIN"
  } else {
    band = "ADEQUATE"
  }

  const dataGaps: EvidenceStrengthAssessment["dataGaps"] = []
  if (legibility.blocksAssessment) {
    dataGaps.push({
      id: "resume-unreadable",
      dimension: "evidence",
      severity: "dimension_blocking",
      label: "Resume could not be read completely",
      missingField: "resumes.raw_text or dated work history",
      whyNotDefaulted: "Unreadable data means HireOven could not inspect the document.",
      resolution: { actor: "candidate", step: "Upload or re-parse a readable resume." },
    })
  } else if (coverage.requiredTermCount === 0) {
    dataGaps.push({
      id: "job-requirements-unextractable",
      dimension: "evidence",
      severity: "decision_relevant",
      label: "No meaningful requirement terms were extracted",
      missingField: "job requirement terms",
      whyNotDefaulted: "A tiny or empty denominator is not evidence of weak or strong coverage.",
      resolution: { actor: "hireoven", step: "Re-read the job description or supply structured requirements." },
    })
  }

  return {
    band,
    confidence: input.signals.confidence ?? (band === "UNREADABLE" ? "low" : "medium"),
    headline: evidenceStatement(band),
    findings: input.signals.findings ?? [],
    dataGaps,
    oldestInputObservedAt: null,
    computedAt: input.computedAt,
    staleInputsDowngraded: false,
    verificationLevel: "inferred",
    requirementSupport: input.signals.requirementSupport,
    coverage,
    buriedEvidence: [...input.signals.buriedEvidence].sort(),
    legibility,
    consistencyNotes: input.signals.consistencyNotes ?? [],
    mayEstablishCapabilityAbsence: false,
  }
}

function coverageFromSupport(
  support: EvidenceSignalInput["requirementSupport"],
): EvidenceStrengthAssessment["coverage"] {
  const requiredTermCount = support.length
  const presentCount = support.filter((item) => item.status === "present").length
  const supportedCount = support.filter((item) => item.status === "missing_supported").length
  const confirmedAbsentCount = support.filter((item) => item.absenceKind === "CANDIDATE_CONFIRMED_ABSENT").length
  const notFoundCount = support.filter(
    (item) =>
      item.status === "missing_needs_confirmation" ||
      item.status === "not_recommended" ||
      item.absenceKind === "NOT_FOUND_IN_READABLE_DATA",
  ).length
  return {
    requiredTermCount,
    presentCount,
    supportedCount,
    notFoundCount,
    confirmedAbsentCount,
    presentRatio: requiredTermCount > 0 ? presentCount / requiredTermCount : null,
  }
}

function evidenceStatement(band: EvidenceBand): string {
  switch (band) {
    case "STRONG":
      return "The resume makes the relevant evidence easy to find."
    case "ADEQUATE":
      return "The resume shows enough relevant evidence for this role."
    case "BURIED":
      return "Relevant evidence appears present but buried."
    case "THIN":
      return "The resume shows limited readable support for important terms."
    case "UNREADABLE":
      return "HireOven could not read enough evidence from the supplied document or posting."
  }
}
