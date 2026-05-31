import type { Plan } from "@/lib/gates"

export type MeteredFeature =
  | "apex_message"
  | "cover_letter"
  | "resume_tailor"
  | "deep_analysis"
  | "autofill"
  | "interview_prep_turn"
  | "apex_strategy"

export type QuotaPeriod = "day" | "month"

export type QuotaConfig = {
  period: QuotaPeriod
  label: string
  shortLabel: string
  limits: Record<Plan, number>
}

// Limits chosen so max monthly AI cost stays well under plan ARR even at 100%
// utilization. See scripts/audit-ai-costs.ts (TODO) for the underlying math.
// Power users above these caps purchase top-up packs (see lib/billing/packs.ts).
export const FEATURE_QUOTAS: Record<MeteredFeature, QuotaConfig> = {
  apex_message: {
    period: "month",
    label: "Apex messages",
    shortLabel: "Apex",
    limits: { free: 15, pro: 150, pro_max: 300 },
  },
  cover_letter: {
    period: "month",
    label: "Cover letters",
    shortLabel: "Cover letters",
    limits: { free: 0, pro: 15, pro_max: 40 },
  },
  resume_tailor: {
    period: "month",
    label: "Resume tailors",
    shortLabel: "Tailors",
    limits: { free: 1, pro: 20, pro_max: 50 },
  },
  deep_analysis: {
    period: "month",
    label: "Deep analyses",
    shortLabel: "Analyses",
    limits: { free: 0, pro: 8, pro_max: 20 },
  },
  autofill: {
    period: "month",
    label: "Autofill uses",
    shortLabel: "Autofill",
    limits: { free: 5, pro: 75, pro_max: 250 },
  },
  interview_prep_turn: {
    period: "month",
    label: "Interview prep turns",
    shortLabel: "Interview turns",
    // Per-turn meter for text + coding interviews (and AI questions/eval on the tracker).
    // Free has zero — interview_prep is plan-gated.
    limits: { free: 0, pro: 50, pro_max: 120 },
  },
  apex_strategy: {
    period: "month",
    label: "Apex strategy plans",
    shortLabel: "Strategy",
    // Strategy / career-engine calls. Free has zero — feature is plan-gated.
    limits: { free: 0, pro: 3, pro_max: 12 },
  },
}

export const METERED_FEATURE_KEYS = Object.keys(FEATURE_QUOTAS) as MeteredFeature[]

export type QuotaState = {
  feature: MeteredFeature
  period: QuotaPeriod
  used: number
  limit: number
  remaining: number
  exceeded: boolean
  /** True when this bump was paid for by a top-up pack rather than the base
   *  plan quota. The call is allowed; client UI can surface a "1 pack credit
   *  used" hint. Only set by bumpUsage; getUsage leaves it undefined. */
  paidWithPack?: boolean
}
