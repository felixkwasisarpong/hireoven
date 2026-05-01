/**
 * Scout AI Router — deterministic-first decision layer.
 *
 * Rules:
 *   - No LLM for hover/UI hints, badges, or cosmetic labels
 *   - No LLM for simple keyword filters ("show remote jobs")
 *   - No LLM for already-normalized/structured data lookups
 *   - LLM only when synthesis, reasoning, writing, or analysis is actually needed
 *
 * This does NOT replace the existing COMMAND_VERB_RE in chat/route.ts.
 * It adds an explicit gate before any Anthropic call is initiated.
 */

import type { RoutingDecision } from "./types"

// Pure UI commands that produce structured actions — no language model needed
const DETERMINISTIC_COMMANDS = /^(show|filter|hide|open|close|sort|clear|reset|refresh|toggle|focus|narrow|expand)\b/i

// Filter-only expressions — just DB queries
const FILTER_ONLY_RE = /^(only|show me|filter (by|to)|limit to|just)\s+(remote|on.?site|hybrid|h.?1b|sponsored|saved|applied|bookmarked|new|recent|entry|senior|mid)/i

// Data that already exists in context — no synthesis needed
const DATA_LOOKUP_RE = /^(what (is|are|was) my match score|what is the (salary|location|remote)|when did i (apply|save)|what (status|stage) is|how many (applications|jobs|saved))\b/i

// Sponsorship signal lookup — purely DB query
const SPONSORSHIP_LOOKUP_RE = /^(does|did|will|has|have)\s+\S+\s+(sponsor|h.?1b|visa|work auth)/i

// Commands that map directly to app navigation
const NAV_COMMANDS_RE = /^(go to|open|show me|take me to)\s+(my (jobs|pipeline|applications|resume|profile|saved|matches|dashboard|settings))/i

export function routeScoutMessage(message: string): RoutingDecision {
  const msg = message.trim()

  if (DETERMINISTIC_COMMANDS.test(msg)) {
    return { useLLM: false, reason: "deterministic command — maps to a structured action" }
  }
  if (FILTER_ONLY_RE.test(msg)) {
    return { useLLM: false, reason: "filter-only expression — no reasoning required" }
  }
  if (DATA_LOOKUP_RE.test(msg)) {
    return { useLLM: false, reason: "data lookup — answer exists in structured context" }
  }
  if (SPONSORSHIP_LOOKUP_RE.test(msg) && msg.split(" ").length <= 8) {
    return { useLLM: false, reason: "sponsorship lookup — resolved from DB data" }
  }
  if (NAV_COMMANDS_RE.test(msg)) {
    return { useLLM: false, reason: "navigation command" }
  }

  return { useLLM: true }
}

// ── Per-feature timeout budgets ───────────────────────────────────────────────

export const AI_TIMEOUTS = {
  scout_chat:            14_000, // non-streaming; streaming has its own abort
  scout_chat_stream:     25_000, // hard stop on stream IIFE
  scout_strategy:        16_000,
  scout_research:         9_000, // per synthesis call (engine has 30s total)
  scout_follow_up:        4_000, // haiku + 2-3 sentences
  scout_mock_interview:   9_000,
  scout_bulk_prepare:    18_000,
  scout_career:          16_000,
  scout_memory_extract:  10_000,
  resume_generate:       25_000,
  resume_ai_write:       12_000,
  resume_tailor_analyze: 12_000,
  cover_letter:          18_000,
  cover_letter_extension:18_000,
  interview_prep:        12_000,
  autofill_improve:       3_500,
  job_normalization:      5_000,
} as const satisfies Record<string, number>

// ── Safe fallback messages ────────────────────────────────────────────────────

export const FALLBACK_MESSAGES = {
  scout_chat:         "Scout is taking a bit longer than expected. Please try again in a moment.",
  scout_strategy:     "Strategy planning is taking longer than usual. Please try again shortly.",
  scout_follow_up:    "Unable to draft the follow-up right now. Try again in a moment.",
  scout_mock_interview: "Interview coaching is temporarily slow. Please try again.",
  scout_research:     "Research is taking longer than expected. Please try again.",
  resume_generate:    "Resume generation is taking longer than expected. Please try again.",
  cover_letter:       "Cover letter generation timed out. Please try again.",
  interview_prep:     "Interview prep is temporarily unavailable. Please try again.",
  autofill_improve:   null, // returns null → caller uses original text
} as const
