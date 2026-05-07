export type AccessLevel = "public" | "auth" | "pro" | "pro_max"
export type Plan = "free" | "pro" | "pro_max"

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
  | "scout_basic"
  | "scout_deep_analysis"
  | "scout_actions"
  | "scout_strategy"
  | "international"
  | "international_advanced"
  | "interview_live"

export const FEATURE_GATES: Record<FeatureKey, AccessLevel> = {
  // Free forever
  watchlist:              "public",
  basic_alerts:           "public",
  match_scores:           "public",   // data-gated (requires resume) — not plan-gated
  resume_upload:          "public",
  job_applications:       "auth",
  scout_basic:            "auth",
  autofill:               "auth",     // quota-gated: free=10/mo, pro=50/mo, pro_max=unlimited
  // All international features free — pages enforce the profile check themselves
  international:          "auth",
  // Metered features (quota lives in lib/usage/quotas.ts)
  deep_analysis:          "auth",
  cover_letter:           "auth",
  // Pro-only
  interview_prep:         "pro",
  scout_deep_analysis:    "pro",
  scout_actions:          "pro",
  // Pro Max only
  international_advanced: "pro_max",
  scout_strategy:         "pro_max",
  interview_live:         "pro_max",
}

export const FEATURE_DESCRIPTIONS: Record<FeatureKey, string> = {
  watchlist:              "Save companies to your watchlist",
  basic_alerts:           "Create job alerts",
  job_applications:       "Track job applications",
  resume_upload:          "Upload your resume",
  deep_analysis:          "AI-powered deep resume analysis",
  cover_letter:           "AI cover letter generation",
  autofill:               "One-click job application autofill",
  match_scores:           "See your match score for each job",
  interview_prep:         "AI interview prep questions",
  scout_basic:            "Basic Scout chat",
  scout_deep_analysis:    "Scout deep analysis and sponsorship intelligence",
  scout_actions:          "Scout advanced actions like resume tailoring",
  scout_strategy:         "Scout strategy plans and application performance insights",
  international:          "International tools — OPT, offer risk, LCA explorer, sponsorship data",
  international_advanced: "Advanced H1B intelligence — petition history, likelihood scores",
  interview_live:         "Live voice + webcam mock interviews",
}

export const PLAN_NAMES: Record<Plan, string> = {
  free:    "Free",
  pro:     "Pro",
  pro_max: "Pro Max",
}

export const PLAN_PRICES = {
  pro:     { monthly: 19, annual: 12 },
  pro_max: { monthly: 29, annual: 19 },
}

const ACCESS_LEVEL_RANK: Record<AccessLevel, number> = {
  public:  0,
  auth:    1,
  pro:     2,
  pro_max: 3,
}

const PLAN_ACCESS_LEVEL: Record<Plan, AccessLevel> = {
  free:    "auth",
  pro:     "pro",
  pro_max: "pro_max",
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
  return "pro_max"
}

export const SOFT_LIMITS: Partial<Record<FeatureKey, number>> = {
  watchlist:    5,
  basic_alerts: 3,
}
