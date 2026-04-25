import type {
  ApplyRecommendation,
  ApplicationVerdict,
  CompanyHiringHealth,
  GhostJobRisk,
  IntelligenceConfidence,
  LcaSalaryComparisonLabel,
  SponsorshipBlocker,
} from "@/types"

export type ApplicationVerdictLabel =
  | "Apply Today"
  | "Apply, But Customize Resume"
  | "Maybe"
  | "Skip"
  | "High Risk"
  | "Unknown"

export type CalculateApplicationVerdictInput = {
  resumeMatchScore?: number | null
  visaFitScore?: number | null
  visaRelevant?: boolean | null
  userNeedsSponsorship?: boolean | null
  sponsorshipBlocker?: SponsorshipBlocker | boolean | null
  salaryAlignment?: LcaSalaryComparisonLabel | null
  ghostJobRisk?: Pick<GhostJobRisk, "score" | "riskLevel" | "freshnessDays" | "recommendedAction"> | null
  jobFreshnessDays?: number | null
  companyHiringHealth?: Pick<CompanyHiringHealth, "status" | "activeJobCount" | "recentJobCount"> | null
  userPreferences?: {
    minimumMatchScore?: number | null
    prefersFreshJobs?: boolean | null
    salaryRequired?: boolean | null
  } | null
  userImmigrationProfile?: {
    isInternational?: boolean | null
    needsSponsorship?: boolean | null
    status?: string | null
  } | null
}

export type ApplicationVerdictResult = {
  verdict: ApplicationVerdictLabel
  recommendation: ApplyRecommendation | "watch" | "avoid" | "unknown"
  priorityScore: number | null
  confidence: IntelligenceConfidence
  reasons: string[]
  warnings: string[]
  recommendedNextAction: string
}

const clampScore = (value: number): number => Math.max(0, Math.min(100, Math.round(value)))

const toScore = (value: number | null | undefined): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  return clampScore(value)
}

const hasBlocker = (blocker: CalculateApplicationVerdictInput["sponsorshipBlocker"]): boolean => {
  if (typeof blocker === "boolean") return blocker
  return Boolean(blocker?.detected)
}

const confidenceForCoverage = (coverage: number): IntelligenceConfidence => {
  if (coverage >= 6) return "high"
  if (coverage >= 3) return "medium"
  if (coverage >= 1) return "low"
  return "unknown"
}

const recommendationForVerdict = (
  verdict: ApplicationVerdictLabel
): ApplicationVerdictResult["recommendation"] => {
  switch (verdict) {
    case "Apply Today":
      return "apply_now"
    case "Apply, But Customize Resume":
      return "apply_with_tweaks"
    case "Maybe":
      return "watch"
    case "Skip":
      return "skip"
    case "High Risk":
      return "avoid"
    default:
      return "unknown"
  }
}

const actionForVerdict = (verdict: ApplicationVerdictLabel): string => {
  switch (verdict) {
    case "Apply Today":
      return "Apply today while the role is fresh. Use your strongest resume version."
    case "Apply, But Customize Resume":
      return "Customize your resume around the top missing requirements before applying."
    case "Maybe":
      return "Save this role and verify the source posting before investing major effort."
    case "Skip":
      return "Skip this role unless new information changes the sponsorship, fit, or freshness signals."
    case "High Risk":
      return "Verify the role and employer policy before applying. Consider prioritizing stronger opportunities."
    default:
      return "Not enough data yet. Review the source posting before deciding."
  }
}

export function calculateApplicationVerdict(input: CalculateApplicationVerdictInput): ApplicationVerdictResult {
  const matchScore = toScore(input.resumeMatchScore)
  const visaScore = toScore(input.visaFitScore)
  const ghostScore = toScore(input.ghostJobRisk?.score)
  const freshnessDays =
    typeof input.jobFreshnessDays === "number"
      ? input.jobFreshnessDays
      : input.ghostJobRisk?.freshnessDays ?? null
  const needsSponsorship =
    input.userNeedsSponsorship ??
    input.userImmigrationProfile?.needsSponsorship ??
    input.userImmigrationProfile?.isInternational ??
    false
  const visaRelevant = input.visaRelevant ?? needsSponsorship
  const blockerDetected = hasBlocker(input.sponsorshipBlocker)
  const reasons: string[] = []
  const warnings: string[] = []
  let score = 50
  let coverage = 0

  if (matchScore !== null) {
    coverage += 1
    if (matchScore >= 80) {
      score += 22
      reasons.push("Strong resume match.")
    } else if (matchScore >= 60) {
      score += 10
      reasons.push("Resume match is workable.")
    } else if (matchScore >= 40) {
      score -= 8
      warnings.push("Resume match is below ideal; customize before applying.")
    } else {
      score -= 20
      warnings.push("Resume match is low.")
    }
  } else {
    warnings.push("Resume match score is missing.")
  }

  if (visaRelevant) {
    coverage += 1
    if (blockerDetected && needsSponsorship) {
      score -= 45
      warnings.push("Sponsorship blocker detected for a user who likely needs sponsorship.")
    } else if (visaScore !== null) {
      if (visaScore >= 70) {
        score += 12
        reasons.push("Visa fit signal is strong enough to consider applying.")
      } else if (visaScore >= 45) {
        score += 2
        reasons.push("Visa fit signal is possible but should be reviewed.")
      } else {
        score -= 18
        warnings.push("Visa fit signal is weak.")
      }
    } else {
      warnings.push("Visa fit score is missing.")
    }
  }

  if (input.salaryAlignment) {
    coverage += 1
    if (input.salaryAlignment === "Aligned" || input.salaryAlignment === "Above Market") {
      score += 6
      reasons.push(`Salary signal is ${input.salaryAlignment.toLowerCase()}.`)
    } else if (input.salaryAlignment === "Below Market") {
      score -= 6
      warnings.push("Salary appears below historical LCA market context.")
    }
  }

  if (ghostScore !== null || input.ghostJobRisk?.riskLevel) {
    coverage += 1
    if (input.ghostJobRisk?.riskLevel === "high" || (ghostScore ?? 0) >= 70) {
      score -= 22
      warnings.push("Ghost-job risk is high.")
    } else if (input.ghostJobRisk?.riskLevel === "medium" || (ghostScore ?? 0) >= 40) {
      score -= 12
      warnings.push("Ghost-job risk should be reviewed.")
    } else {
      score += 8
      reasons.push("Ghost-job risk looks low.")
    }
  }

  const ghostRiskAlreadyCoversFreshness = input.ghostJobRisk?.riskLevel === "high"
  if (typeof freshnessDays === "number" && Number.isFinite(freshnessDays)) {
    coverage += 1
    if (freshnessDays <= 7) {
      score += 10
      reasons.push("Job is fresh.")
    } else if (freshnessDays > 45 && !ghostRiskAlreadyCoversFreshness) {
      score -= 12
      warnings.push(`Job is ${freshnessDays} days old; verify it is still active.`)
    }
  }

  if (input.companyHiringHealth) {
    coverage += 1
    if (input.companyHiringHealth.status === "growing") {
      score += 8
      reasons.push("Company hiring health looks positive.")
    } else if (input.companyHiringHealth.status === "slowing") {
      score -= 6
      warnings.push("Company hiring health appears slower.")
    } else if ((input.companyHiringHealth.activeJobCount ?? 0) > 0) {
      score += 3
      reasons.push("Company has active openings.")
    }
  }

  const minMatch = input.userPreferences?.minimumMatchScore
  if (typeof minMatch === "number" && matchScore !== null && matchScore < minMatch) {
    score -= 8
    warnings.push(`Resume match is below your preferred ${minMatch}% threshold.`)
  }

  const priorityScore = coverage === 0 ? null : clampScore(score)
  let verdict: ApplicationVerdictLabel

  if (priorityScore === null) {
    verdict = "Unknown"
  } else if (blockerDetected && needsSponsorship) {
    verdict = priorityScore <= 35 || input.ghostJobRisk?.riskLevel === "high" ? "High Risk" : "Skip"
  } else if (input.ghostJobRisk?.riskLevel === "high" && priorityScore < 70) {
    verdict = priorityScore < 45 ? "Skip" : "Maybe"
  } else if (priorityScore >= 78 && (matchScore ?? 0) >= 70) {
    verdict = "Apply Today"
  } else if (priorityScore >= 58 && (matchScore ?? 0) < 70) {
    verdict = "Apply, But Customize Resume"
  } else if (priorityScore >= 45) {
    verdict = "Maybe"
  } else {
    verdict = "Skip"
  }

  return {
    verdict,
    recommendation: recommendationForVerdict(verdict),
    priorityScore,
    confidence: confidenceForCoverage(coverage),
    reasons,
    warnings,
    recommendedNextAction: actionForVerdict(verdict),
  }
}

export function applicationVerdictResultToIntelligence(
  result: ApplicationVerdictResult,
  computedAt: string | null = null
): ApplicationVerdict {
  return {
    verdict: result.verdict,
    recommendation: result.recommendation,
    confidence: result.confidence,
    score: result.priorityScore,
    priorityScore: result.priorityScore,
    reasons: result.reasons,
    warnings: result.warnings,
    blockers: result.warnings.filter((warning) => /blocker|high risk|weak|low/i.test(warning)),
    recommendedNextAction: result.recommendedNextAction,
    nextBestAction: result.recommendedNextAction,
    computedAt,
  }
}
