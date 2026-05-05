import type { Plan } from "@/lib/gates"

export type MeteredFeature =
  | "scout_message"
  | "cover_letter"
  | "resume_tailor"
  | "deep_analysis"

export type QuotaPeriod = "day" | "month"

export type QuotaConfig = {
  period: QuotaPeriod
  label: string
  shortLabel: string
  limits: Record<Plan, number>
}

export const FEATURE_QUOTAS: Record<MeteredFeature, QuotaConfig> = {
  scout_message: {
    period: "day",
    label: "Scout messages",
    shortLabel: "Scout",
    limits: { free: 5, pro: 100, pro_international: 100 },
  },
  cover_letter: {
    period: "month",
    label: "Cover letters",
    shortLabel: "Cover letters",
    limits: { free: 2, pro: 30, pro_international: 50 },
  },
  resume_tailor: {
    period: "month",
    label: "Resume tailors",
    shortLabel: "Tailors",
    limits: { free: 2, pro: 30, pro_international: 50 },
  },
  deep_analysis: {
    period: "month",
    label: "Deep analyses",
    shortLabel: "Analyses",
    limits: { free: 1, pro: 20, pro_international: 40 },
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
