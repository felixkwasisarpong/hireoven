import { canAccess, type FeatureKey, type Plan } from "@/lib/gates"
import type { ApexMode, ApexResponse } from "./types"

export type ApexPremiumGate = NonNullable<ApexResponse["gated"]>

type PremiumIntentRule = {
  feature: FeatureKey
  reason: string
  upgradeMessage: string
  test: (input: { message: string; mode: ApexMode }) => boolean
}

const PREMIUM_INTENT_RULES: PremiumIntentRule[] = [
  {
    feature: "apex_actions",
    reason: "Resume tailoring actions are part of Apex Pro actions.",
    upgradeMessage: "Upgrade to unlock resume tailoring shortcuts and advanced Apex actions.",
    test: ({ message }) =>
      /\b(tailor|tailoring|rewrite|optimize|optimi[sz]e)\b.*\bresume\b|\bresume\b.*\b(tailor|tailoring)\b/i.test(
        message
      ),
  },
  {
    feature: "apex_deep_analysis",
    reason: "Deep sponsorship analysis is available on paid Apex plans.",
    upgradeMessage: "Upgrade to unlock deeper sponsorship intelligence and evidence-driven risk analysis.",
    test: ({ message }) =>
      /\bdeep\b.*\b(sponsorship|h-?1b|visa)\b|\bsponsorship\b.*\bdeep\b|\bdetailed sponsorship\b/i.test(
        message
      ),
  },
  {
    feature: "interview_prep",
    reason: "Job-specific interview prep is available on Pro.",
    upgradeMessage: "Upgrade to unlock grounded interview prep with role focus, resume talking points, gaps, and practice questions.",
    test: ({ message }) =>
      /\b(interview prep|prepare me for (this|the) interview|questions should i expect|how should i prepare for (this|the) role|prep for (this|the) job|prepare for (this|the) job)\b/i.test(
        message
      ),
  },
  {
    feature: "apex_strategy",
    reason: "Strategy command-center recommendations are part of paid Apex.",
    upgradeMessage: "Upgrade to unlock strategy playbooks, application performance insights, and multi-step action plans.",
    test: ({ message, mode }) =>
      mode === "applications" ||
      /\b(strategy|playbook|roadmap|plan for this week|multi-step|multi step|funnel|pipeline|conversion|performance insights?)\b/i.test(
        message
      ),
  },
]

export function findApexPremiumGate(input: {
  plan: Plan | null
  message: string
  mode: ApexMode
}): ApexPremiumGate | null {
  for (const rule of PREMIUM_INTENT_RULES) {
    if (rule.test({ message: input.message, mode: input.mode }) && !canAccess(input.plan, rule.feature)) {
      return {
        feature: rule.feature,
        reason: rule.reason,
        upgradeMessage: rule.upgradeMessage,
      }
    }
  }

  return null
}

export function canUseAdvancedApexActions(plan: Plan | null): boolean {
  return canAccess(plan, "apex_actions")
}

export function canUsePremiumApexFeatures(plan: Plan | null): boolean {
  return (
    canAccess(plan, "apex_deep_analysis") &&
    canAccess(plan, "apex_actions") &&
    canAccess(plan, "apex_strategy")
  )
}

export function buildGatedApexResponse(input: {
  gate: ApexPremiumGate
  mode: ApexMode
  answer?: string
}): ApexResponse {
  return {
    answer:
      input.answer ??
      "I can give you a useful free-level answer right now. The deeper version of this request is locked on your current plan.",
    recommendation: "Explore",
    actions: [],
    mode: input.mode,
    gated: input.gate,
  }
}

