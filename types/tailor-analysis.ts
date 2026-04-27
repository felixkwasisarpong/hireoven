/**
 * Job-description ↔ resume tailoring analysis (AI Studio — Tailor Resume).
 */

export type TailorSkillSuggestionStatus =
  | "present"
  | "missing_supported"
  | "missing_needs_confirmation"
  | "not_recommended"

export type TailorSkillSuggestion = {
  skill: string
  status: TailorSkillSuggestionStatus
  evidence?: string
  reason: string
  targetSection: "skills" | "experience" | "do_not_add"
}

export type TailorBulletSuggestion = {
  id: string
  experienceId: string
  company?: string
  role?: string
  original: string
  issue: string
  suggested: string
  reason: string
  confidence: "high" | "medium" | "low"
}

export type TailorSummarySuggestion = {
  original: string
  issue: string
  suggested: string
  reason: string
  confidence: "high" | "medium" | "low"
}

export type TailorFixAddSkill = {
  id: string
  type: "add_skill"
  label: string
  skill: string
  target: "skills"
  before: string
  after: string
  reason: string
  requiresConfirmation: boolean
}

export type TailorFixReplaceBullet = {
  id: string
  type: "replace_bullet"
  label: string
  experienceId: string
  original: string
  suggested: string
  reason: string
  requiresConfirmation: boolean
}

export type TailorFixReplaceSummary = {
  id: string
  type: "replace_summary"
  label: string
  original: string
  suggested: string
  reason: string
  requiresConfirmation: boolean
}

export type TailorFix = TailorFixAddSkill | TailorFixReplaceBullet | TailorFixReplaceSummary

export type TailorRoleAlignment = "strong" | "moderate" | "weak"

export type TailorAnalysisResult = {
  matchScore: number
  roleAlignment: TailorRoleAlignment
  presentKeywords: string[]
  missingKeywords: string[]
  skillSuggestions: TailorSkillSuggestion[]
  bulletSuggestions: TailorBulletSuggestion[]
  summarySuggestion?: TailorSummarySuggestion
  fixes: TailorFix[]
  warnings: string[]
}

export type TailorWorkflowStep = "idle" | "analyzed" | "applying" | "applied"
