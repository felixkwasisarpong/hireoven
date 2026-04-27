/**
 * Resume Hub — extended UI-layer types.
 *
 * These complement the core Resume / ResumeVersion / ResumeAnalysis types in
 * types/index.ts with view-model shapes, AI action definitions, and generator
 * input contracts needed by the Resume Hub pages.
 */

// ─── Status ─────────────────────────────────────────────────────────────────

export type ResumeStatus = "active" | "draft" | "tailored" | "archived"

// ─── Library view model ──────────────────────────────────────────────────────

/** Flattened view-model used by ResumeLibrary cards. */
export type ResumeDocument = {
  id: string
  name: string
  targetRole: string | null
  lastUpdated: string
  /** Resume quality score 0–100 (from resume_score). */
  qualityScore: number | null
  /** ATS readability score 0–100 (computed separately). */
  atsScore: number | null
  /** Job-match score if the resume is linked to a specific job posting. */
  matchScore: number | null
  linkedJobId: string | null
  linkedJobTitle: string | null
  status: ResumeStatus
  versionCount: number
  isPrimary: boolean
}

// ─── Score breakdown ─────────────────────────────────────────────────────────

export type ResumeScoreCategory = {
  key: string
  label: string
  /** 0–100 normalised score. */
  score: number
  /** Human-readable explanation of the score. */
  explanation: string
  /** One-line action the user can take. */
  suggestion: string
  /** Contribution weight out of 100. */
  weight: number
  /** Icon name (lucide). */
  icon: string
}

export type ResumeScoreBreakdown = {
  overall: number
  categories: ResumeScoreCategory[]
}

// ─── Tailoring ───────────────────────────────────────────────────────────────

export type TailoredBulletSuggestion = {
  section: string
  original: string
  suggested: string
  reason: string
  keywords: string[]
}

export type ResumeTailoringAnalysis = {
  jobTitle: string
  company: string | null
  matchScore: number
  missingKeywords: string[]
  presentKeywords: string[]
  bulletSuggestions: TailoredBulletSuggestion[]
  suggestedSummaryRewrite: string | null
  /** Skills the AI recommends adding — user must verify they are truthful. */
  suggestedSkillsToAdd: string[]
  warnings: string[]
}

// ─── AI actions (editor tool cards) ─────────────────────────────────────────

export type ResumeAiActionCategory =
  | "improve"
  | "format"
  | "tailor"
  | "rewrite"
  | "international"

export type ResumeAiAction = {
  id: string
  label: string
  description: string
  /** Lucide icon name string. */
  icon: string
  category: ResumeAiActionCategory
  estimatedTime: string
  isPremium: boolean
}

// ─── AI Generator ────────────────────────────────────────────────────────────

export type ResumeSourceType = "profile" | "upload" | "linkedin" | "manual"
export type ResumeExperienceLevel =
  | "internship"
  | "entry"
  | "mid"
  | "senior"
  | "executive"
export type ResumeStyle = "concise" | "technical" | "executive" | "new_grad"
export type ResumeTone = "direct" | "polished" | "impact_focused"

export type ResumeGenerationInput = {
  sourceType: ResumeSourceType
  sourceResumeId?: string | null
  targetRole: string
  experienceLevel: ResumeExperienceLevel
  resumeStyle: ResumeStyle
  tone: ResumeTone
  targetIndustry: string
  jobDescription: string
  linkedinSummary: string
  manualInput: string
}

// ─── Version meta ────────────────────────────────────────────────────────────

export type ResumeVersionMeta = {
  id: string
  resumeId: string
  versionNumber: number
  name: string | null
  createdAt: string
  changesSummary: string | null
  linkedJobTitle: string | null
  linkedCompany: string | null
  /** Quality score at the time this version was saved. */
  scoreAtSave: number | null
  /** Delta vs. the previous version (positive = improvement). */
  scoreDelta: number | null
  hasSnapshot: boolean
  hasFile: boolean
}

// ─── Backend-loaded hub data ─────────────────────────────────────────────────

export type ResumeHubRecentEdit = {
  id: string
  resumeId: string
  toolId: string
  label: string
  status: string
  createdAt: string
}

export type ResumeHubResumeMeta = {
  resumeId: string
  status: ResumeStatus
  matchScore: number | null
  versionCount: number
  linkedJobId: string | null
  linkedJobTitle: string | null
  linkedCompany: string | null
}

export type ResumeHubTargetJob = {
  id: string
  title: string
  company: string | null
  description: string | null
  matchScore: number | null
  status: string | null
}

export type ResumeHubTailoringRecord = ResumeTailoringAnalysis & {
  id: string
  resumeId: string
  jobId: string | null
  jobDescription: string
  createdAt: string
}

export type ResumeHubProfile = {
  isInternational: boolean
  visaStatus: string | null
  needsSponsorship: boolean
  optEndDate: string | null
}

export type ResumeHubData = {
  recentEdits: ResumeHubRecentEdit[]
  resumeMeta: Record<string, ResumeHubResumeMeta>
  targetJobs: ResumeHubTargetJob[]
  tailoringAnalyses: ResumeHubTailoringRecord[]
  profile: ResumeHubProfile | null
}
