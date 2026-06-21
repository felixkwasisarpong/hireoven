export type BillingInterval = "monthly" | "yearly"

export const PLAN_DATA = {
  free: {
    name: "Free",
    monthly: 0,
    yearly: 0,
    yearlyBilled: 0,
    tagline: "Everything to start your search",
    cta: "Get started free",
    ctaHref: "/signup",
    color: "slate",
    badge: null,
    badgeStyle: null,
    highlighted: false,
  },
  pro: {
    name: "Pro",
    monthly: 19,
    yearly: 12,
    yearlyBilled: 149,
    tagline: "Everything you need to land the job",
    cta: "Start Pro",
    ctaHref: "/signup?plan=pro&interval=monthly",
    color: "teal",
    badge: "Most popular",
    badgeStyle: "teal",
    highlighted: true,
  },
  pro_max: {
    name: "Pro Max",
    monthly: 29,
    yearly: 19,
    yearlyBilled: 229,
    tagline: "Apex strategy, unlimited everything, and live interview credits",
    cta: "Start Pro Max",
    ctaHref: "/signup?plan=pro_max&interval=monthly",
    color: "blue",
    badge: "Best for serious candidates",
    badgeStyle: "blue",
    highlighted: false,
  },
} as const

export type PlanKey = keyof typeof PLAN_DATA

export function getSignupUrl(plan: PlanKey, interval: BillingInterval): string {
  if (plan === "free") return "/signup"
  const params = new URLSearchParams({ plan, interval })
  return `/signup?${params.toString()}`
}

export function getPlanAmountCents(plan: PlanKey, interval: BillingInterval): number {
  const data = PLAN_DATA[plan]
  if (plan === "free") return 0
  const yearlyBilled = "yearlyBilled" in data ? data.yearlyBilled : 0
  return interval === "yearly" ? yearlyBilled * 100 : data.monthly * 100
}

export const FREE_FEATURES = [
  "Real-time job feed",
  "Freshness scores on every listing",
  "H1B sponsorship badge on listings",
  "Company sponsorship profiles",
  "Sponsorship likelihood score on listings",
  "Visa language detection on every JD",
  "H1B petition history (3 years)",
  "OPT countdown, offer risk, LCA explorer & urgency routing (profile-gated)",
  "Priority alerts from sponsoring companies (profile-gated)",
  "Up to 5 company watchlist",
  "Up to 3 job alerts",
  "Basic application tracker",
  "Resume upload (3 resumes)",
  "Match scores (requires resume)",
  "Apex chat (15/month)",
  "Autofill (5/month)",
  "No sponsored listings ever",
]

export const PRO_FEATURES = [
  "Everything in Free, plus:",
  "Unlimited watchlist + alerts",
  "Unlimited resumes",
  "AI match scores on every job",
  "AI resume editor",
  "Apex chat (150/month)",
  "Cover letters (15/month)",
  "Deep resume analysis (8/month)",
  "Resume tailors (20/month)",
  "Autofill (75/month)",
  "Interview prep turns (50/month)",
  "Full application tracker",
  "Text + coding interviews with debrief",
  "Apex AI: actions, tailoring, deep analysis",
]

export const PRO_MAX_FEATURES = [
  "Everything in Pro, plus:",
  "Apex chat (300/month)",
  "Cover letters (40/month)",
  "Deep resume analyses (20/month)",
  "Resume tailors (50/month)",
  "Autofill (250/month)",
  "Interview prep turns (120/month)",
  "Apex strategy plans (12/month) + cohort insights",
  "1 free live voice interview every 28 days",
  "Top-up packs available when you hit any cap",
]

export type PlanComparisonRow = {
  feature: string
  free: boolean | string | number
  pro: boolean | string | number
  proMax: boolean | string | number
  tooltip?: string
  isGroupHeader?: boolean
}

/**
 * Canonical pricing/gating matrix used across public pricing, upgrade, and billing surfaces.
 * Keep lock-points here so UI copy cannot drift from the actual plan model.
 */
export const PLAN_COMPARISON_ROWS: PlanComparisonRow[] = [
  { feature: "Job discovery", free: "", pro: "", proMax: "", isGroupHeader: true },
  { feature: "Real-time feed + freshness scores", free: true, pro: true, proMax: true },
  { feature: "H1B badge on every listing", free: true, pro: true, proMax: true },
  { feature: "Match scores", free: "Requires resume", pro: true, proMax: true },
  { feature: "Company watchlist", free: "5 max", pro: "Unlimited", proMax: "Unlimited" },
  { feature: "Job alerts", free: "3 max", pro: "Unlimited", proMax: "Unlimited" },

  { feature: "Resume tools", free: "", pro: "", proMax: "", isGroupHeader: true },
  { feature: "Resume upload", free: "3 resumes", pro: "Unlimited", proMax: "Unlimited" },
  { feature: "Deep resume analysis", free: false, pro: "8/mo", proMax: "20/mo" },
  { feature: "Resume tailors", free: "1/mo", pro: "20/mo", proMax: "50/mo" },
  { feature: "AI resume editor", free: false, pro: true, proMax: true },
  { feature: "Cover letters", free: false, pro: "15/mo", proMax: "40/mo" },
  {
    feature: "Application autofill",
    free: "5/mo",
    pro: "75/mo",
    proMax: "250/mo",
    tooltip: "Fill Greenhouse, Lever, and Ashby forms with one click",
  },

  { feature: "International (profile-gated on Free)", free: "", pro: "", proMax: "", isGroupHeader: true },
  { feature: "Sponsorship profiles + H1B badges", free: true, pro: true, proMax: true },
  { feature: "Sponsorship likelihood score", free: true, pro: true, proMax: true },
  { feature: "Visa language detection", free: true, pro: true, proMax: true },
  { feature: "H1B petition history (3yr)", free: true, pro: true, proMax: true },
  { feature: "OPT countdown + offer risk analyzer", free: "Intl. profile", pro: true, proMax: true },
  {
    feature: "Priority alerts from sponsoring companies",
    free: "Intl. profile",
    pro: true,
    proMax: true,
  },

  { feature: "Apex AI", free: "", pro: "", proMax: "", isGroupHeader: true },
  { feature: "Apex chat", free: "15/mo", pro: "150/mo", proMax: "300/mo" },
  { feature: "Resume tailoring & actions", free: false, pro: true, proMax: true },
  { feature: "Strategy & cohort insights", free: false, pro: "3/mo", proMax: "12/mo" },

  { feature: "Interviews", free: "", pro: "", proMax: "", isGroupHeader: true },
  { feature: "Text + coding interview turns", free: false, pro: "50/mo", proMax: "120/mo" },
  { feature: "Interview debrief", free: false, pro: true, proMax: true },
  {
    feature: "Live voice + webcam interview",
    free: "Credits (pay-as-you-go)",
    pro: "Credits (pay-as-you-go)",
    proMax: "1 free credit / 28d + top-ups",
    tooltip: "1 session credit per 28 days on Pro Max, with optional paid credit packs on all plans.",
  },

  { feature: "Top-up packs", free: "", pro: "", proMax: "", isGroupHeader: true },
  {
    feature: "Buy extra credits when you hit a cap",
    free: false,
    pro: true,
    proMax: true,
    tooltip: "Apex, interview turns, deep analysis, and autofill credit packs available à la carte.",
  },
]
