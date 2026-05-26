import type { JobMatchScore, ResumeAnalysis } from "@/types"

export type ScoreFactorComputationState = "computed" | "not_computed"

export type ScoreFactorValue = {
  value: number | null
  state: ScoreFactorComputationState
  reason: string | null
}

type FactorInput = {
  analysis?: Pick<
    ResumeAnalysis,
    "skills_score" | "matching_skills" | "missing_skills" | "bonus_skills"
  > | null
  fastScore?: Pick<JobMatchScore, "skills_score" | "total_required_skills" | "score_breakdown"> | null
}

function hasItems(value: string[] | null | undefined): boolean {
  return Array.isArray(value) && value.length > 0
}

function deriveRequiredSkillCount(
  fastScore: Pick<JobMatchScore, "total_required_skills" | "score_breakdown"> | null | undefined
): number | null {
  if (!fastScore) return null
  const fromScore = fastScore.total_required_skills
  if (typeof fromScore === "number" && Number.isFinite(fromScore)) return fromScore
  const fromBreakdown = fastScore.score_breakdown?.totalRequiredSkills
  if (typeof fromBreakdown === "number" && Number.isFinite(fromBreakdown)) return fromBreakdown
  return null
}

/**
 * Resolve skills-factor value while distinguishing real zero from no-compute.
 */
export function resolveSkillsFactorValue(input: FactorInput): ScoreFactorValue {
  const requiredSkills = deriveRequiredSkillCount(input.fastScore ?? null)

  if (input.analysis) {
    const analysisScore = input.analysis.skills_score
    if (analysisScore == null) {
      return { value: null, state: "not_computed", reason: "analysis_missing_skill_score" }
    }
    const hasEvidence =
      hasItems(input.analysis.matching_skills) ||
      hasItems(input.analysis.missing_skills) ||
      hasItems(input.analysis.bonus_skills)

    if (analysisScore === 0 && !hasEvidence && (requiredSkills == null || requiredSkills <= 0)) {
      return { value: null, state: "not_computed", reason: "no_skill_evidence" }
    }

    return { value: analysisScore, state: "computed", reason: null }
  }

  if (requiredSkills != null && requiredSkills <= 0) {
    return { value: null, state: "not_computed", reason: "no_required_skills" }
  }

  const fastScoreValue = input.fastScore?.skills_score ?? null
  if (fastScoreValue == null) {
    return { value: null, state: "not_computed", reason: "fast_score_missing_skill_score" }
  }

  return { value: fastScoreValue, state: "computed", reason: null }
}
