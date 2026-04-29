import type {
  CapExemptSignal,
  IntelligenceConfidence,
  SponsorshipBlocker,
  StemOptReadiness,
  VisaFitScoreLabel,
} from "@/types"

export type WageLevelSignal = "strong" | "moderate" | "weak" | "unknown"

export type CalculateVisaFitScoreInput = {
  jobTitle?: string | null
  jobDescription?: string | null
  companyName?: string | null
  sponsorsH1b?: boolean | null
  sponsorshipScore?: number | null
  priorLcaCount?: number | null
  recentLcaCount?: number | null
  roleFamilyLcaCount?: number | null
  locationLcaCount?: number | null
  wageLevelSignal?: WageLevelSignal | null
  eVerify?: boolean | null
  capExempt?: boolean | CapExemptSignal | null
  sponsorshipBlocker?: SponsorshipBlocker | null
  dataRecencyDays?: number | null
}

export type VisaFitScoreResult = {
  score: number
  label: VisaFitScoreLabel
  confidence: Exclude<IntelligenceConfidence, "unknown">
  reasons: string[]
  warnings: string[]
  dataGaps: string[]
  stemOptReadiness: StemOptReadiness
  capExempt: CapExemptSignal | null
}

const clampScore = (value: number): number => Math.min(100, Math.max(0, Math.round(value)))

const hasText = (value: string | null | undefined): boolean => Boolean(value?.trim())

const toCount = (value: number | null | undefined): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null
  }

  return Math.floor(value)
}

const labelForScore = (score: number): VisaFitScoreLabel => {
  if (score < 25) return "Blocked"
  if (score < 45) return "Weak"
  if (score < 65) return "Medium"
  if (score < 82) return "Strong"
  return "Very Strong"
}

const confidenceForCoverage = (coverage: number): Exclude<IntelligenceConfidence, "unknown"> => {
  if (coverage >= 7) return "high"
  if (coverage >= 4) return "medium"
  return "low"
}

const normalizeCapExempt = (value: CalculateVisaFitScoreInput["capExempt"]): CapExemptSignal | null => {
  if (typeof value === "boolean") {
    return {
      isLikelyCapExempt: value,
      category: "unknown",
      confidence: value ? "medium" : "unknown",
      evidence: [],
      summary: value ? "Employer may be cap-exempt; treat separately from regular H-1B cap odds." : null,
    }
  }

  return value ?? null
}

const buildStemOptReadiness = (input: CalculateVisaFitScoreInput): StemOptReadiness => {
  const eVerifyKnown = typeof input.eVerify === "boolean"
  const description = `${input.jobTitle ?? ""} ${input.jobDescription ?? ""}`.toLowerCase()
  const stemRelatedRole = /engineer|software|data|scientist|developer|machine learning|security|systems|analytics/.test(
    description
  )

  return {
    eligible: eVerifyKnown && input.eVerify && stemRelatedRole ? true : null,
    score: eVerifyKnown ? (input.eVerify ? (stemRelatedRole ? 78 : 62) : 35) : null,
    eVerifyLikely: input.eVerify ?? null,
    stemRelatedRole,
    employerTrainingPlanRisk: input.eVerify === false ? "high" : input.eVerify === true ? "low" : "unknown",
    missingSignals: eVerifyKnown ? [] : ["E-Verify status is unknown"],
    summary: input.eVerify
      ? "E-Verify signal supports STEM OPT readiness when the candidate and role otherwise qualify."
      : null,
  }
}

export const calculateVisaFitScore = (input: CalculateVisaFitScoreInput): VisaFitScoreResult => {
  const blocker = input.sponsorshipBlocker
  const capExempt = normalizeCapExempt(input.capExempt)
  const stemOptReadiness = buildStemOptReadiness(input)
  const reasons: string[] = []
  const warnings: string[] = []
  const dataGaps: string[] = []

  if (blocker?.detected) {
    return {
      score: 12,
      label: "Blocked",
      confidence: blocker.confidence === "high" || blocker.confidence === "medium" ? blocker.confidence : "medium",
      reasons: ["The posting contains a sponsorship or work-authorization blocker."],
      warnings: [
        "Treat this as decision support only, not legal advice.",
        ...blocker.evidence.map((evidence) => `Blocker evidence: ${evidence}`),
      ],
      dataGaps,
      stemOptReadiness,
      capExempt,
    }
  }

  let score = 50
  let coverage = 0

  if (input.sponsorsH1b === true) {
    score += 12
    coverage += 1
    reasons.push("Employer has an H-1B sponsorship signal.")
  } else if (input.sponsorsH1b === false) {
    score -= 8
    coverage += 1
    warnings.push("Employer is not currently marked as an H-1B sponsor.")
  } else {
    dataGaps.push("Employer H-1B sponsorship flag is unknown.")
  }

  if (typeof input.sponsorshipScore === "number" && Number.isFinite(input.sponsorshipScore)) {
    coverage += 1
    if (input.sponsorshipScore >= 75) {
      score += 10
      reasons.push("Employer sponsorship score is strong.")
    } else if (input.sponsorshipScore >= 50) {
      score += 4
      reasons.push("Employer sponsorship score is moderate.")
    } else if (input.sponsorshipScore > 0) {
      score -= 4
      warnings.push("Employer sponsorship score is limited.")
    }
  } else {
    dataGaps.push("Employer sponsorship score is missing.")
  }

  const priorLcaCount = toCount(input.priorLcaCount)
  const recentLcaCount = toCount(input.recentLcaCount)
  const roleFamilyLcaCount = toCount(input.roleFamilyLcaCount)
  const locationLcaCount = toCount(input.locationLcaCount)

  if (recentLcaCount !== null) {
    coverage += 1
    if (recentLcaCount >= 25) {
      score += 16
      reasons.push("Employer has strong recent LCA filing history.")
    } else if (recentLcaCount >= 5) {
      score += 10
      reasons.push("Employer has recent LCA filing history.")
    } else if (recentLcaCount > 0) {
      score += 4
      reasons.push("Employer has at least one recent LCA filing.")
    } else {
      warnings.push("No recent LCA filings were found.")
    }
  } else {
    dataGaps.push("Recent LCA count is missing.")
  }

  if (priorLcaCount !== null) {
    coverage += 1
    if (priorLcaCount >= 100) {
      score += 10
      reasons.push("Employer has deep historical LCA volume.")
    } else if (priorLcaCount >= 20) {
      score += 6
      reasons.push("Employer has meaningful historical LCA volume.")
    } else if (priorLcaCount === 0) {
      warnings.push("No prior LCA history was found for the employer.")
    }
  } else {
    dataGaps.push("Prior LCA count is missing.")
  }

  if (roleFamilyLcaCount !== null) {
    coverage += 1
    if (roleFamilyLcaCount >= 10) {
      score += 12
      reasons.push("Employer has LCA history for similar role families.")
    } else if (roleFamilyLcaCount > 0) {
      score += 6
      reasons.push("Employer has some LCA history for similar roles.")
    } else {
      score -= 14
      warnings.push("Employer LCA history exists, but not for this role family.")
    }
  } else {
    dataGaps.push("Role-family LCA count is missing.")
  }

  if (locationLcaCount !== null) {
    coverage += 1
    if (locationLcaCount >= 10) {
      score += 8
      reasons.push("Employer has LCA filings in this worksite location.")
    } else if (locationLcaCount > 0) {
      score += 4
      reasons.push("Employer has some LCA filings in this location.")
    } else {
      warnings.push("No same-location LCA history was found.")
    }
  } else {
    dataGaps.push("Location/worksite LCA count is missing.")
  }

  if (input.wageLevelSignal && input.wageLevelSignal !== "unknown") {
    coverage += 1
    if (input.wageLevelSignal === "strong") {
      score += 6
      reasons.push("Wage signal appears compatible with LCA expectations.")
    } else if (input.wageLevelSignal === "moderate") {
      score += 2
      reasons.push("Wage signal is moderate.")
    } else {
      score -= 6
      warnings.push("Wage signal may be weak for sponsorship support.")
    }
  } else {
    dataGaps.push("Wage-level signal is missing.")
  }

  if (typeof input.dataRecencyDays === "number" && Number.isFinite(input.dataRecencyDays)) {
    coverage += 1
    if (input.dataRecencyDays <= 365) {
      score += 5
      reasons.push("Immigration data is recent.")
    } else if (input.dataRecencyDays > 1_095) {
      score -= 5
      warnings.push("Immigration data may be stale.")
    }
  } else {
    dataGaps.push("Data recency is unknown.")
  }

  if (input.eVerify === true) {
    coverage += 1
    reasons.push("E-Verify signal supports STEM OPT readiness.")
  } else if (input.eVerify === false) {
    coverage += 1
    warnings.push("E-Verify signal is not present; STEM OPT readiness may be limited.")
  } else {
    dataGaps.push("E-Verify signal is unknown.")
  }

  if (capExempt?.isLikelyCapExempt === true) {
    coverage += 1
    reasons.push("Employer may be cap-exempt; this is tracked separately from regular H-1B cap fit.")
    warnings.push("Cap-exempt status should not be blended blindly into regular H-1B lottery odds.")
  } else if (capExempt?.isLikelyCapExempt === false) {
    coverage += 1
  } else {
    dataGaps.push("Cap-exempt signal is unknown.")
  }

  if (!hasText(input.jobTitle)) {
    dataGaps.push("Job title is missing.")
  }

  if (!hasText(input.jobDescription)) {
    dataGaps.push("Job description is missing.")
  }

  if (!hasText(input.companyName)) {
    dataGaps.push("Company name is missing.")
  }

  const finalScore = clampScore(score)

  return {
    score: finalScore,
    label: labelForScore(finalScore),
    confidence: confidenceForCoverage(coverage),
    reasons,
    warnings,
    dataGaps,
    stemOptReadiness,
    capExempt,
  }
}

