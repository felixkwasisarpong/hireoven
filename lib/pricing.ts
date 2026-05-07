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
    cta: "Start Pro free for 7 days",
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
    tagline: "Live interviews, Scout strategy, and unlimited everything",
    cta: "Start Pro Max free for 7 days",
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
  "Autofill (10/month)",
  "No sponsored listings ever",
]

export const PRO_FEATURES = [
  "Everything in Free, plus:",
  "Unlimited watchlist + alerts",
  "Unlimited resumes",
  "AI match scores on every job",
  "AI resume editor",
  "Gap analysis against any job",
  "Cover letters (25/month)",
  "Deep resume analysis (20/month)",
  "Autofill (50/month)",
  "Full application tracker",
  "AI interview prep",
  "Text + coding interviews with debrief",
  "Scout AI: actions, tailoring, deep analysis",
]

export const PRO_MAX_FEATURES = [
  "Everything in Pro, plus:",
  "Unlimited cover letters",
  "Unlimited deep resume analyses",
  "Unlimited autofill",
  "Live voice + webcam interviews (2/month)",
  "Buy extra live interview credits",
  "Scout strategy plans + cohort insights",
]
