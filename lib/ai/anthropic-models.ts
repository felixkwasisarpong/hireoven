import {
  DEFAULT_HAIKU_MODEL,
  DEFAULT_SONNET_MODEL,
  DEFAULT_OPUS_MODEL,
} from "@/lib/ai/anthropic-model-defaults"

function envOverride(name: "ANTHROPIC_HAIKU_MODEL" | "ANTHROPIC_SONNET_MODEL" | "ANTHROPIC_OPUS_MODEL", fallback: string): string {
  const value = process.env[name]?.trim()
  return value && value.length > 0 ? value : fallback
}

export const HAIKU_MODEL = envOverride("ANTHROPIC_HAIKU_MODEL", DEFAULT_HAIKU_MODEL)
export const SONNET_MODEL = envOverride("ANTHROPIC_SONNET_MODEL", DEFAULT_SONNET_MODEL)
export const OPUS_MODEL = envOverride("ANTHROPIC_OPUS_MODEL", DEFAULT_OPUS_MODEL)

export const ANTHROPIC_TIER_PRICING = {
  haiku: {
    inputPerMillion: 0.8,
    outputPerMillion: 4,
  },
  sonnet: {
    inputPerMillion: 3,
    outputPerMillion: 15,
  },
  opus: {
    inputPerMillion: 15,
    outputPerMillion: 75,
  },
} as const

/**
 * Centralized routing constants by workload.
 *
 * Keep UI-only interactions deterministic: no LLM for hover hints, badges,
 * or client-side cosmetic effects.
 */
export const ANTHROPIC_MODEL_ROUTING = {
  JOB_NORMALIZATION: HAIKU_MODEL,
  JOB_SKILL_EXTRACTION: HAIKU_MODEL,
  JOB_METADATA_PARSING: HAIKU_MODEL,
  SCOUT_GROUNDED_QA: SONNET_MODEL,
  SCOUT_STRATEGY: SONNET_MODEL,
  SCOUT_PLANNING: SONNET_MODEL,
  RESUME_TAILORING: SONNET_MODEL,
  COVER_LETTER: SONNET_MODEL,
  INTERVIEW_PREP: SONNET_MODEL,
  H1B_DEEP_ANALYSIS: SONNET_MODEL,
  HARD_FALLBACK_REPAIR: OPUS_MODEL,
} as const
