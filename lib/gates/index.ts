export type AccessLevel = "public" | "auth" | "pro" | "pro_international"
export type Plan = "free" | "pro" | "pro_international"

export type FeatureKey =
  | "watchlist"
  | "basic_alerts"
  | "job_applications"
  | "resume_upload"
  | "deep_analysis"
  | "cover_letter"
  | "autofill"
  | "match_scores"
  | "interview_prep"
  | "international"

export const FEATURE_GATES: Record<FeatureKey, AccessLevel> = {
  // Auth-gated
  watchlist: "auth",
  basic_alerts: "auth",
  job_applications: "auth",
  // Pro-gated
  resume_upload: "pro",
  deep_analysis: "pro",
  cover_letter: "pro",
  autofill: "pro",
  match_scores: "pro",
  interview_prep: "pro",
  // Pro + International add-on
  international: "pro_international",
}

export const FEATURE_DESCRIPTIONS: Record<FeatureKey, string> = {
  watchlist: "Save companies to your watchlist",
  basic_alerts: "Create job alerts",
  job_applications: "Track job applications",
  resume_upload: "Upload and manage your resume",
  deep_analysis: "AI-powered deep resume analysis",
  cover_letter: "AI cover letter generation",
  autofill: "One-click job application autofill",
  match_scores: "See your match score for each job",
  interview_prep: "AI interview prep questions",
  international: "International job listings and visa data",
}

export const PLAN_NAMES: Record<Plan, string> = {
  free: "Free",
  pro: "Pro",
  pro_international: "Pro + International",
}

export const PLAN_PRICES = {
  pro: { monthly: 19, annual: 14 },
  pro_international: { monthly: 29, annual: 22 },
}

const ACCESS_LEVEL_RANK: Record<AccessLevel, number> = {
  public: 0,
  auth: 1,
  pro: 2,
  pro_international: 3,
}

const PLAN_ACCESS_LEVEL: Record<Plan, AccessLevel> = {
  free: "auth",
  pro: "pro",
  pro_international: "pro_international",
}

export function meetsAccessLevel(plan: Plan | null, required: AccessLevel): boolean {
  if (required === "public") return true
  if (required === "auth") return plan !== null
  const planLevel = plan ? ACCESS_LEVEL_RANK[PLAN_ACCESS_LEVEL[plan]] : 0
  return planLevel >= ACCESS_LEVEL_RANK[required]
}

export function canAccess(plan: Plan | null, feature: FeatureKey): boolean {
  return meetsAccessLevel(plan, FEATURE_GATES[feature])
}

export function requiredPlanFor(feature: FeatureKey): Plan | null {
  const level = FEATURE_GATES[feature]
  if (level === "public" || level === "auth") return null
  if (level === "pro") return "pro"
  return "pro_international"
}

export const SOFT_LIMITS: Partial<Record<FeatureKey, number>> = {
  watchlist: 5,
  basic_alerts: 3,
}
