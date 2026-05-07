import type { Plan } from "@/lib/gates"

export type MeteredFeature =
  | "scout_message"
  | "cover_letter"
  | "resume_tailor"
  | "deep_analysis"
  | "autofill"

export type QuotaPeriod = "day" | "month"

export type QuotaConfig = {
  period: QuotaPeriod
  label: string
  shortLabel: string
  limits: Record<Plan, number>
}

// Sentinel for "unlimited" — nothing in practice exceeds this count.
const UNLIMITED = 999_999

export const FEATURE_QUOTAS: Record<MeteredFeature, QuotaConfig> = {
  scout_message: {
    period: "day",
    label: "Scout messages",
    shortLabel: "Scout",
    limits: { free: 5, pro: 30, pro_max: 60 },
  },
  cover_letter: {
    period: "month",
    label: "Cover letters",
    shortLabel: "Cover letters",
    limits: { free: 0, pro: 25, pro_max: UNLIMITED },
  },
  resume_tailor: {
    period: "month",
    label: "Resume tailors",
    shortLabel: "Tailors",
    limits: { free: 2, pro: 30, pro_max: UNLIMITED },
  },
  deep_analysis: {
    period: "month",
    label: "Deep analyses",
    shortLabel: "Analyses",
    limits: { free: 0, pro: 20, pro_max: UNLIMITED },
  },
  autofill: {
    period: "month",
    label: "Autofill uses",
    shortLabel: "Autofill",
    limits: { free: 10, pro: 50, pro_max: UNLIMITED },
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
}
