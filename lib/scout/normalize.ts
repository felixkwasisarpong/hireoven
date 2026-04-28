/**
 * Client-side Scout response normalizer.
 *
 * Converts any unknown API payload into a well-shaped ScoutResponse so UI
 * components never encounter raw JSON strings, missing fields, or unexpected
 * types.  This is the last line of defence after the server-side parser; it
 * does NOT change business logic.
 */

import {
  isScoutIntent,
  isScoutMode,
  type ScoutCompareResponse,
  type ScoutExplanationBlock,
  type ScoutInterviewPrep,
  type ScoutResponse,
  type ScoutWorkflow,
} from "@/lib/scout/types"

const VALID_RECOMMENDATIONS = new Set(["Apply", "Skip", "Improve", "Wait", "Explore"])

function isValidRecommendation(value: unknown): value is ScoutResponse["recommendation"] {
  return typeof value === "string" && VALID_RECOMMENDATIONS.has(value)
}

function stripCodeFence(text: string): string {
  const fenced = text.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/i)
  if (fenced) return fenced[1].trim()
  return text
}

/**
 * Attempt to unwrap a double-encoded answer field.
 * Happens when the API-side JSON.parse fails (e.g. code-fence wrapper missed)
 * and the raw JSON string ends up stored in `answer`.
 */
function tryUnwrapJsonAnswer(answer: string): Record<string, unknown> | null {
  const cleaned = stripCodeFence(answer.trim())
  if (!cleaned.startsWith("{")) return null
  try {
    const inner = JSON.parse(cleaned) as unknown
    if (
      typeof inner === "object" &&
      inner !== null &&
      "answer" in (inner as Record<string, unknown>) &&
      "recommendation" in (inner as Record<string, unknown>)
    ) {
      return inner as Record<string, unknown>
    }
  } catch {
    // not valid JSON — leave as-is
  }
  return null
}

export function normalizeScoutResponse(raw: unknown): ScoutResponse {
  // Hard fallback for completely unexpected shapes
  if (typeof raw !== "object" || raw === null) {
    return {
      answer:
        typeof raw === "string" && raw.trim()
          ? raw.trim()
          : "Scout returned an unexpected response.",
      recommendation: "Explore",
      actions: [],
    }
  }

  let record = raw as Record<string, unknown>

  // If `answer` itself looks like raw JSON (server-side normalizer was bypassed),
  // try to unwrap it one level.
  if (typeof record.answer === "string") {
    const unwrapped = tryUnwrapJsonAnswer(record.answer)
    if (unwrapped) record = unwrapped
  }

  const answer =
    typeof record.answer === "string" && record.answer.trim()
      ? record.answer.trim()
      : "Scout returned an unexpected response."

  const recommendation = isValidRecommendation(record.recommendation)
    ? record.recommendation
    : "Explore"

  const actions = Array.isArray(record.actions)
    ? (record.actions as ScoutResponse["actions"])
    : []

  const explanations = Array.isArray(record.explanations)
    ? (record.explanations as ScoutExplanationBlock[])
    : undefined

  const workflow =
    typeof record.workflow === "object" && record.workflow !== null
      ? (record.workflow as ScoutWorkflow)
      : undefined

  const intent = isScoutIntent(record.intent) ? record.intent : undefined
  const mode = isScoutMode(record.mode) ? record.mode : undefined
  const confidence =
    typeof record.confidence === "number" ? record.confidence : undefined

  const gated =
    typeof record.gated === "object" &&
    record.gated !== null &&
    "feature" in (record.gated as Record<string, unknown>) &&
    "upgradeMessage" in (record.gated as Record<string, unknown>)
      ? (record.gated as ScoutResponse["gated"])
      : undefined

  const compare =
    typeof record.compare === "object" && record.compare !== null
      ? (record.compare as ScoutCompareResponse)
      : undefined

  const interviewPrep =
    typeof record.interviewPrep === "object" && record.interviewPrep !== null
      ? (record.interviewPrep as ScoutInterviewPrep)
      : undefined

  return {
    answer,
    recommendation,
    actions,
    explanations,
    workflow,
    intent,
    mode,
    confidence,
    gated,
    compare,
    interviewPrep,
  }
}
