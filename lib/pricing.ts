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
    cta: "Start Pro free — 7 days",
    ctaHref: "/signup?plan=pro&interval=monthly",
    color: "teal",
    badge: "Most popular",
    badgeStyle: "teal",
    highlighted: true,
  },
  pro_international: {
    name: "Pro International",
    monthly: 24,
    yearly: 16,
    yearlyBilled: 189,
    tagline: "Designed for OPT, STEM OPT, and H1B seekers",
    cta: "Start Pro International — 7 days free",
    ctaHref: "/signup?plan=pro_international&interval=monthly",
    color: "blue",
    badge: "Built for international candidates",
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
  "Up to 5 company watchlist",
  "Up to 3 job alerts",
  "Basic application tracker",
  "Direct company page links",
  "No sponsored listings ever",
]

export const PRO_FEATURES = [
  "Everything in Free, plus:",
  "AI match scores on every job",
  "Resume upload + AI parsing",
  "Gap analysis against any job",
  "AI resume editor",
  "Cover letter generator (10/month)",
  "Deep resume analysis (20/month)",
  "Unlimited watchlist + alerts",
  "Application autofill",
  "Full application tracker",
  "OPT countdown dashboard",
  "Company sponsorship profiles",
  "AI interview prep",
]

export const PRO_INTL_FEATURES = [
  "Everything in Pro, plus:",
  "Unlimited cover letters",
  "Unlimited deep resume analyses",
  "H1B petition history by company (3 years)",
  "Sponsorship likelihood score on every listing",
  "Priority alerts from sponsoring companies",
  "OPT urgency routing",
  "Visa language detection on every JD",
  "STEM OPT extension planning tools",
]
