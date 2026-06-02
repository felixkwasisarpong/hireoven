/**
 * Client-side Apex response normalizer.
 *
 * Converts any unknown API payload into a well-shaped ApexResponse so UI
 * components never encounter raw JSON strings, missing fields, or unexpected
 * types.  This is the last line of defence after the server-side parser; it
 * does NOT change business logic.
 */

import {
  isApexIntent,
  isApexMode,
  type ApexCompareResponse,
  type ApexExplanationBlock,
  type ApexInterviewPrep,
  type ApexResponse,
  type ApexWorkflow,
  type ApexWorkflowDirective,
  type ApexWorkspaceDirective,
  type ApexWorkspaceMode,
} from "@/lib/apex/types"
import { sanitizeGeneratedText } from "@/lib/text/sanitize-generated-text"

const VALID_WORKSPACE_MODES = new Set<ApexWorkspaceMode>([
  "idle", "search", "compare", "tailor", "applications", "bulk_application", "company", "research", "outreach", "interview", "career_strategy",
  "autonomous_hunt",
  "offer_negotiation", "salary_coaching", "burnout_checkin", "post_hire_checkin", "personal_brand",
  "jd_decoder", "reputation_guard", "pipeline_sim", "shadow_network", "auto_apply",
])

function isWorkspaceMode(v: unknown): v is ApexWorkspaceMode {
  return typeof v === "string" && VALID_WORKSPACE_MODES.has(v as ApexWorkspaceMode)
}

function normalizeWorkspaceDirective(raw: unknown): ApexWorkspaceDirective | undefined {
  if (typeof raw !== "object" || raw === null) return undefined
  const r = raw as Record<string, unknown>
  if (!isWorkspaceMode(r.mode)) return undefined

  const rail =
    typeof r.rail === "object" && r.rail !== null
      ? (r.rail as ApexWorkspaceDirective["rail"])
      : r.rail === null
        ? null
        : undefined

  const chips = Array.isArray(r.chips) ? (r.chips as string[]).filter((c) => typeof c === "string") : undefined
  const transition = typeof r.transition === "string" ? (r.transition as ApexWorkspaceDirective["transition"]) : undefined
  const payload = typeof r.payload === "object" && r.payload !== null ? (r.payload as Record<string, unknown>) : undefined

  return { mode: r.mode, transition, payload, rail, chips }
}

const VALID_RECOMMENDATIONS = new Set(["Apply", "Skip", "Improve", "Wait", "Explore"])

function isValidRecommendation(value: unknown): value is ApexResponse["recommendation"] {
  return typeof value === "string" && VALID_RECOMMENDATIONS.has(value)
}

function stripCodeFence(text: string): string {
  const fenced = text.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/i)
  if (fenced) return fenced[1].trim()
  return text
}

function extractJsonObjectCandidate(text: string): string | null {
  const cleaned = stripCodeFence(text.trim())
  const start = cleaned.indexOf("{")
  if (start === -1) return null

  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < cleaned.length; i++) {
    const char = cleaned[i]

    if (escaped) {
      escaped = false
      continue
    }

    if (char === "\\") {
      escaped = inString
      continue
    }

    if (char === '"') {
      inString = !inString
      continue
    }

    if (inString) continue

    if (char === "{") depth += 1
    if (char === "}") depth -= 1

    if (depth === 0) return cleaned.slice(start, i + 1)
  }

  return null
}

function tryParseApexResponseObject(text: string): Record<string, unknown> | null {
  const candidate = extractJsonObjectCandidate(text)
  if (!candidate) return null

  try {
    const parsed = JSON.parse(candidate) as unknown
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // not valid JSON — leave as-is
  }

  return null
}

/**
 * Attempt to unwrap a double-encoded answer field.
 * Happens when the API-side JSON.parse fails (e.g. code-fence wrapper missed)
 * and the raw JSON string ends up stored in `answer`.
 */
function tryUnwrapJsonAnswer(answer: string): Record<string, unknown> | null {
  const inner = tryParseApexResponseObject(answer)
  if (
    inner &&
    "answer" in inner &&
    "recommendation" in inner
  ) {
    return inner
  }

  return null
}

export function normalizeApexResponse(raw: unknown): ApexResponse {
  if (typeof raw === "string") {
    const parsed = tryParseApexResponseObject(raw)
    if (parsed) return normalizeApexResponse(parsed)
  }

  // Hard fallback for completely unexpected shapes
  if (typeof raw !== "object" || raw === null) {
    return sanitizeGeneratedText({
      answer:
        typeof raw === "string" && raw.trim()
          ? raw.trim()
          : "Apex returned an unexpected response.",
      recommendation: "Explore",
      actions: [],
    })
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
      : "Apex returned an unexpected response."

  const recommendation = isValidRecommendation(record.recommendation)
    ? record.recommendation
    : "Explore"

  const actions = Array.isArray(record.actions)
    ? (record.actions as ApexResponse["actions"])
    : []

  const explanations = Array.isArray(record.explanations)
    ? (record.explanations as ApexExplanationBlock[])
    : undefined

  const workflow =
    typeof record.workflow === "object" && record.workflow !== null
      ? (record.workflow as ApexWorkflow)
      : undefined

  const intent = isApexIntent(record.intent) ? record.intent : undefined
  const mode = isApexMode(record.mode) ? record.mode : undefined
  const confidence =
    typeof record.confidence === "number" ? record.confidence : undefined

  const gated =
    typeof record.gated === "object" &&
    record.gated !== null &&
    "feature" in (record.gated as Record<string, unknown>) &&
    "upgradeMessage" in (record.gated as Record<string, unknown>)
      ? (record.gated as ApexResponse["gated"])
      : undefined

  const compare =
    typeof record.compare === "object" && record.compare !== null
      ? (record.compare as ApexCompareResponse)
      : undefined

  const interviewPrep =
    typeof record.interviewPrep === "object" && record.interviewPrep !== null
      ? (record.interviewPrep as ApexInterviewPrep)
      : undefined

  const workspace_directive = normalizeWorkspaceDirective(record.workspace_directive)
  const workflow_directive = normalizeWorkflowDirective(record.workflow_directive)

  // Pass graph through as-is — it's server-validated structural data
  const graph =
    typeof record.graph === "object" && record.graph !== null
      ? (record.graph as ApexResponse["graph"])
      : undefined

  const debug =
    typeof record.debug === "object" && record.debug !== null
      ? (record.debug as ApexResponse["debug"])
      : undefined

  // Pass outreach through as-is — server-validated before writing to ApexResponse
  const outreach =
    typeof record.outreach === "object" && record.outreach !== null
      ? (record.outreach as ApexResponse["outreach"])
      : undefined

  const apply_agent =
    typeof record.apply_agent === "object" && record.apply_agent !== null
      ? (record.apply_agent as ApexResponse["apply_agent"])
      : undefined

  return sanitizeGeneratedText({
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
    workspace_directive,
    workflow_directive,
    graph,
    debug,
    outreach,
    apply_agent,
  })
}

function normalizeWorkflowDirective(raw: unknown): ApexWorkflowDirective | undefined {
  if (typeof raw !== "object" || raw === null) return undefined
  const r = raw as Record<string, unknown>
  if (typeof r.workflowType !== "string" || !r.workflowType.trim()) return undefined
  return {
    workflowType: r.workflowType.trim(),
    workflowId: typeof r.workflowId === "string" ? r.workflowId : undefined,
    payload: typeof r.payload === "object" && r.payload !== null
      ? (r.payload as Record<string, unknown>)
      : undefined,
  }
}
