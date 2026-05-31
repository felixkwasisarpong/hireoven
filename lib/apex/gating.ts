import { canAccess, type FeatureKey, type Plan } from "@/lib/gates"
import type { ScoutMode, ScoutResponse } from "./types"

export type ScoutPremiumGate = NonNullable<ScoutResponse["gated"]>

type PremiumIntentRule = {
  feature: FeatureKey
  reason: string
  upgradeMessage: string
  test: (input: { message: string; mode: ScoutMode }) => boolean
}

const PREMIUM_INTENT_RULES: PremiumIntentRule[] = [
  {
    feature: "scout_actions",
    reason: "Resume tailoring actions are part of Scout Pro actions.",
    upgradeMessage: "Upgrade to unlock resume tailoring shortcuts and advanced Scout actions.",
    test: ({ message }) =>
      /\b(tailor|tailoring|rewrite|optimize|optimi[sz]e)\b.*\bresume\b|\bresume\b.*\b(tailor|tailoring)\b/i.test(
        message
      ),
  },
  {
    feature: "scout_deep_analysis",
    reason: "Deep sponsorship analysis is available on paid Scout plans.",
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
    feature: "scout_strategy",
    reason: "Strategy command-center recommendations are part of paid Scout.",
    upgradeMessage: "Upgrade to unlock strategy playbooks, application performance insights, and multi-step action plans.",
    test: ({ message, mode }) =>
      mode === "applications" ||
      /\b(strategy|playbook|roadmap|plan for this week|multi-step|multi step|funnel|pipeline|conversion|performance insights?)\b/i.test(
        message
      ),
  },
]

export function findScoutPremiumGate(input: {
  plan: Plan | null
  message: string
  mode: ScoutMode
}): ScoutPremiumGate | null {
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

export function canUseAdvancedScoutActions(plan: Plan | null): boolean {
  return canAccess(plan, "scout_actions")
}

export function canUsePremiumScoutFeatures(plan: Plan | null): boolean {
  return (
    canAccess(plan, "scout_deep_analysis") &&
    canAccess(plan, "scout_actions") &&
    canAccess(plan, "scout_strategy")
  )
}

export function buildGatedScoutResponse(input: {
  gate: ScoutPremiumGate
  mode: ScoutMode
  answer?: string
}): ScoutResponse {
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

