import type { MeteredFeature } from "@/lib/usage/quotas"

export type PackKey =
  | "scout_50"
  | "scout_200"
  | "interview_25"
  | "interview_100"
  | "deep_10"
  | "deep_30"
  | "autofill_50"
  | "autofill_200"
  | "cover_letter_15"
  | "resume_tailor_25"
  | "scout_strategy_5"

export type PackDefinition = {
  feature: MeteredFeature
  credits: number
  amountCents: number
  label: string
  description: string
}

export const FEATURE_PACKS: Record<PackKey, PackDefinition> = {
  scout_50: {
    feature: "scout_message",
    credits: 50,
    amountCents: 400,
    label: "+50 Scout messages",
    description: "Extra Scout chat for the rest of the month.",
  },
  scout_200: {
    feature: "scout_message",
    credits: 200,
    amountCents: 1200,
    label: "+200 Scout messages",
    description: "Best value Scout top-up.",
  },
  interview_25: {
    feature: "interview_prep_turn",
    credits: 25,
    amountCents: 500,
    label: "+25 Interview prep turns",
    description: "Extra turns for text + coding interviews and tracker prep.",
  },
  interview_100: {
    feature: "interview_prep_turn",
    credits: 100,
    amountCents: 1500,
    label: "+100 Interview prep turns",
    description: "Best value interview prep top-up.",
  },
  deep_10: {
    feature: "deep_analysis",
    credits: 10,
    amountCents: 700,
    label: "+10 Deep resume analyses",
    description: "Extra detailed analyses for the rest of the month.",
  },
  deep_30: {
    feature: "deep_analysis",
    credits: 30,
    amountCents: 1800,
    label: "+30 Deep resume analyses",
    description: "Best value deep-analysis top-up.",
  },
  autofill_50: {
    feature: "autofill",
    credits: 50,
    amountCents: 300,
    label: "+50 Autofill uses",
    description: "Fill more application forms in one click.",
  },
  autofill_200: {
    feature: "autofill",
    credits: 200,
    amountCents: 900,
    label: "+200 Autofill uses",
    description: "Best value autofill top-up.",
  },
  cover_letter_15: {
    feature: "cover_letter",
    credits: 15,
    amountCents: 600,
    label: "+15 Cover letters",
    description: "Extra AI-drafted cover letters.",
  },
  resume_tailor_25: {
    feature: "resume_tailor",
    credits: 25,
    amountCents: 700,
    label: "+25 Resume tailors",
    description: "Extra AI-tailored resume versions.",
  },
  scout_strategy_5: {
    feature: "scout_strategy",
    credits: 5,
    amountCents: 800,
    label: "+5 Scout strategy plans",
    description: "Extra strategy + career-engine runs.",
  },
}

export const PACK_KEYS = Object.keys(FEATURE_PACKS) as PackKey[]

export function isPackKey(value: unknown): value is PackKey {
  return typeof value === "string" && value in FEATURE_PACKS
}
