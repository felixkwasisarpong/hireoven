import Anthropic from "@anthropic-ai/sdk"
import { NextRequest, NextResponse } from "next/server"
import { logApiUsage } from "@/lib/admin/usage"
import { createClient } from "@/lib/supabase/server"
import { getScoutContext, formatScoutContextForClaude } from "@/lib/scout/context"
import { resolveJobContext, listTopSavedJobs } from "@/lib/scout/resolve-job-context"
import { encodeSSE } from "@/lib/scout/streaming/types"
import { runOrchestrator, detectAgentIntent } from "@/lib/scout/agents/orchestrator"
import { isAllowedScoutAction, normalizeScoutActions } from "@/lib/scout/actions"
import { detectScoutMode } from "@/lib/scout/mode"
import { getScoutSystemPrompt } from "@/lib/scout/prompts"
import {
  buildGatedScoutResponse,
  canUseAdvancedScoutActions,
  canUsePremiumScoutFeatures,
  findScoutPremiumGate,
} from "@/lib/scout/gating"
import { canAccess, type Plan } from "@/lib/gates"
import { getUserPlan } from "@/lib/gates/server-gate"
import { bumpScoutUsage } from "@/lib/scout/free-tier-quota"
import { ANTHROPIC_TIER_PRICING, SONNET_MODEL } from "@/lib/ai/anthropic-models"
import { budgetTracker, calcCost, inferTier } from "@/lib/scout/budget/tracker"
import { streamWithTimeout } from "@/lib/scout/budget/ai-call"
import { isAiBudgetExceeded } from "@/lib/scout/budget/cap"
import { routeScoutMessage, AI_TIMEOUTS } from "@/lib/scout/budget/router"
import { scoutCache, CACHE_TTL, cacheKey, stableHash } from "@/lib/scout/budget/cache"
import { sanitizeGeneratedText } from "@/lib/text/sanitize-generated-text"
import {
  isScoutIntent,
  isScoutMode,
  type ScoutCompareItem,
  type ScoutCompareRecommendation,
  type ScoutCompareResponse,
  type ScoutEvidenceBridgeBlock,
  type ScoutEvidenceBridgeItemStatus,
  type ScoutExplanationBlock,
  type ScoutExplanationBlockType,
  type ScoutExplanationItemStatus,
  type ScoutInterviewPrep,
  type ScoutStandardExplanationBlock,
  type ScoutIntent,
  type ScoutMode,
  type ScoutResponse,
  type ScoutWorkflow,
  type ScoutWorkflowDirective,
} from "@/lib/scout/types"

export const runtime = "nodejs"
export const maxDuration = 30

/**
 * Scout Chat API - Phase 1.2: Grounded Context Retrieval
 * 
 * Test Scenarios:
 * 
 * 1. No Context (should say insufficient data):
 *    POST /api/scout/chat
 *    { "message": "Should I apply to this job?" }
 *    Expected: Scout says "I need more information - which job are you referring to?"
 * 
 * 2. With Job ID (should use job/company/resume context):
 *    POST /api/scout/chat
 *    { "message": "Is this a good fit for me?", "jobId": "uuid-here" }
 *    Expected: Scout analyzes based on job description, company sponsorship data, user's resume
 * 
 * 3. With Company ID only (should use company context):
 *    POST /api/scout/chat
 *    { "message": "Does this company sponsor H-1B?", "companyId": "uuid-here" }
 *    Expected: Scout provides sponsorship data if available
 * 
 * 4. With Resume ID (should use specific resume):
 *    POST /api/scout/chat
 *    { "message": "What's missing from my resume?", "resumeId": "uuid-here" }
 *    Expected: Scout reviews that specific resume
 * 
 * 5. Job + Match Score exists:
 *    POST /api/scout/chat
 *    { "message": "What's my match score for this role?", "jobId": "uuid-here" }
 *    Expected: Scout explains existing match score breakdown
 */

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null

// Grounded Scout Q&A/compare workflows need better instruction following and reasoning depth.
const MODEL = SONNET_MODEL
const MODEL_PRICING = ANTHROPIC_TIER_PRICING.sonnet
const IS_DEV = process.env.NODE_ENV === "development"
const COMMAND_VERB_RE = /^(show|filter|find|open|compare|improve|prepare|focus|hide|narrow|sort)\b/i
const WORKFLOW_HINT_RE = /\b(workflow|plan|steps|step-by-step|checklist|roadmap)\b/i
const ANALYSIS_HINT_RE = /\b(analyz|analysis|score|fit|verdict|breakdown|evaluate|assess)\b/i
const QUESTION_HINT_RE = /(\?$)|\b(what|why|how|should|can|could|would|is|are|do|does)\b/i
const COMPARE_HINT_RE =
  /\b(compare|which (one|job|of|saved)|which should|rank (these|my|saved)|side.?by.?side)\b/i
const INTERVIEW_PREP_HINT_RE =
  /\b(interview prep|prepare me for (this|the) interview|questions should i expect|how should i prepare for (this|the) role|give me interview prep|prep for (this|the) job|prepare for (this|the) job)\b/i

const COMPARE_RECOMMENDATIONS = new Set<ScoutCompareRecommendation>(["Best", "Good", "Risky", "Skip"])

function scoutError(status: number, message: string) {
  return NextResponse.json({ ok: false, status, message, error: message }, { status })
}

function sanitizeScoutResponse(response: ScoutResponse): ScoutResponse {
  return sanitizeGeneratedText(response)
}

/**
 * Free-tier users can still execute safe "basic" Scout controls (filtering,
 * focus mode, navigation). This pass strips only premium actions/features.
 */
function stripProOnlyFieldsForFreeUsers(
  response: ScoutResponse,
  plan: Plan | null
): ScoutResponse {
  if (canAccess(plan, "scout_actions")) return response

  const filteredActions = (response.actions ?? []).filter((action) => !isPremiumScoutAction(action))
  const removedPremiumActions = filteredActions.length !== (response.actions ?? []).length

  const filteredWorkflow = response.workflow
    ? {
        ...response.workflow,
        steps: response.workflow.steps.map((step) => ({
          ...step,
          action:
            step.action && isPremiumWorkflowAction(step.action)
              ? undefined
              : step.action,
        })),
      }
    : undefined

  const removedPremiumWorkflowStep =
    Boolean(response.workflow) &&
    response.workflow!.steps.some((step, idx) => step.action && !filteredWorkflow!.steps[idx]?.action)

  const interviewPrepAllowed = canAccess(plan, "interview_prep")
  const removedInterviewPrep = Boolean(response.interviewPrep) && !interviewPrepAllowed

  const gated =
    response.gated ??
    (removedPremiumActions || removedPremiumWorkflowStep || removedInterviewPrep
      ? {
          feature: "scout_actions" as const,
          reason: "Some advanced Scout actions are part of paid plans.",
          upgradeMessage: "Upgrade to unlock resume tailoring and advanced Scout workflows.",
        }
      : undefined)

  return {
    ...response,
    actions: filteredActions,
    workflow: filteredWorkflow,
    interviewPrep: interviewPrepAllowed ? response.interviewPrep : undefined,
    gated,
  }
}

function parseCompareResponse(
  raw: unknown,
  knownJobIds: Set<string>
): ScoutCompareResponse | null {
  if (!raw || typeof raw !== "object") return null
  const p = raw as Record<string, unknown>

  if (typeof p.summary !== "string" || !p.summary.trim()) return null
  if (!Array.isArray(p.items) || p.items.length < 2) return null

  const items: ScoutCompareItem[] = []
  for (const rawItem of p.items) {
    if (!rawItem || typeof rawItem !== "object") continue
    const item = rawItem as Record<string, unknown>
    if (typeof item.jobId !== "string" || typeof item.title !== "string") continue
    if (!knownJobIds.has(item.jobId)) continue // discard hallucinated IDs

    items.push({
      jobId: item.jobId,
      title: item.title,
      company: typeof item.company === "string" ? item.company : undefined,
      matchScore: typeof item.matchScore === "number" ? item.matchScore : null,
      sponsorshipSignal: typeof item.sponsorshipSignal === "string" ? item.sponsorshipSignal : null,
      salaryRange: typeof item.salaryRange === "string" ? item.salaryRange : null,
      location: typeof item.location === "string" ? item.location : null,
      riskSummary: typeof item.riskSummary === "string" ? item.riskSummary : undefined,
      recommendation: COMPARE_RECOMMENDATIONS.has(item.recommendation as ScoutCompareRecommendation)
        ? (item.recommendation as ScoutCompareRecommendation)
        : undefined,
    })
    if (items.length >= 5) break
  }

  if (items.length < 2) return null

  const winnerJobId =
    typeof p.winnerJobId === "string" && knownJobIds.has(p.winnerJobId)
      ? p.winnerJobId
      : undefined

  const tradeoffs = Array.isArray(p.tradeoffs)
    ? p.tradeoffs.filter((t): t is string => typeof t === "string" && t.trim().length > 0).slice(0, 4)
    : undefined

  return {
    summary: p.summary,
    items,
    winnerJobId,
    tradeoffs: tradeoffs && tradeoffs.length > 0 ? tradeoffs : undefined,
  }
}

function parseStringList(raw: unknown, maxItems: number): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim())
    .slice(0, maxItems)
}

function parseInterviewPrep(raw: unknown): ScoutInterviewPrep | undefined {
  if (!raw || typeof raw !== "object") return undefined
  const p = raw as Record<string, unknown>

  const prep: ScoutInterviewPrep = {
    roleFocus: parseStringList(p.roleFocus, 4),
    likelyTopics: parseStringList(p.likelyTopics, 4),
    resumeTalkingPoints: parseStringList(p.resumeTalkingPoints, 4),
    gapsToPrepare: parseStringList(p.gapsToPrepare, 4),
    practiceQuestions: parseStringList(p.practiceQuestions, 6),
  }

  const companyNotes = parseStringList(p.companyNotes, 4)
  if (companyNotes.length > 0) prep.companyNotes = companyNotes

  const hasContent =
    prep.roleFocus.length > 0 ||
    prep.likelyTopics.length > 0 ||
    prep.resumeTalkingPoints.length > 0 ||
    prep.gapsToPrepare.length > 0 ||
    prep.practiceQuestions.length > 0 ||
    (prep.companyNotes?.length ?? 0) > 0

  return hasContent ? prep : undefined
}

function buildInterviewPrepPreview(input: {
  jobTitle: string
  companyName: string
  jobId: string
  hasResume: boolean
  hasMatchScore: boolean
  mode: ScoutMode
}): ScoutResponse {
  const previewBits = [
    `I can build full interview prep for ${input.jobTitle} at ${input.companyName}.`,
    input.hasResume
      ? "Preview: anchor your prep around the role responsibilities, your strongest matching resume evidence, and any gaps Scout found."
      : "Preview: start by reviewing the job requirements and bring a resume into context for tailored talking points.",
    input.hasMatchScore
      ? "I can also use the existing match context to turn weaker areas into practice prompts."
      : "If a match score is available, I can use it to focus the prep on weaker areas.",
  ]

  return {
    answer: previewBits.join(" "),
    recommendation: "Improve",
    actions: [
      {
        type: "OPEN_JOB",
        payload: { jobId: input.jobId },
        label: "Review job before prep",
      },
    ],
    explanations: [],
    intent: "analysis",
    confidence: 0.86,
    mode: input.mode,
    gated: {
      feature: "interview_prep",
      reason: "Full job-specific interview prep requires Pro.",
      upgradeMessage: "Upgrade to unlock grounded role focus, resume talking points, gaps, and practice questions for this job.",
    },
  }
}
// ── Workflow directive inference ──────────────────────────────────────────────

const TAILOR_INTENT_RE = /\b(tailor|cover.?letter|autofill|prepare.?application|prepare.?my.?resume|full.?application|apply.?to.?this)\b/i
const COMPARE_INTENT_RE = /\b(compare|prioritize|rank.*(jobs|saved|my)|which.*apply.*first|shortlist)\b/i
const INTERVIEW_INTENT_RE = /\b(interview.?prep|prepare.*(for.*(this|the)|interview)|mock.?interview|practice.?questions)\b/i

function detectInterviewType(message: string): string | undefined {
  const m = message.toLowerCase()
  if (/\b(recruiter|phone\s+screen|hr\s+screen)\b/.test(m)) return "recruiter_screen"
  if (/\b(system.?design|architecture\s+round)\b/.test(m))  return "system_design"
  if (/\b(technical|coding|algorithm|code\s+interview)\b/.test(m)) return "technical"
  if (/\b(behavioral|behaviour|star\s+format|tell\s+me\s+about)\b/.test(m)) return "behavioral"
  if (/\b(hiring\s+manager|manager\s+round)\b/.test(m)) return "manager"
  if (/\b(onsite|on.?site|interview\s+loop|full\s+loop)\b/.test(m)) return "onsite"
  return undefined
}

// Bulk application prep — matches explicit batch language OR "apply to/for N jobs/roles"
// Examples that must match:
//   "Prepare 5 applications for..."
//   "Queue visa-friendly roles over 80 match"
//   "apply to 2 jobs with match score greater than 80"
//   "apply for 3 roles"
//   "start applying to 10 positions"
const BULK_PREP_RE =
  /(?:\b(?:prepare|queue|batch|bulk)\b.{0,80}\b(?:jobs?|roles?|positions?|openings?|application[s]?|apply|applying)\b)|(?:\bapply\s+(?:to|for)\s+(?:(?:my|the|some|a\s+few|several)\s+)?(?:(?:top|best|strongest|highest)\s+)?\d+\s+(?:\S+\s+){0,4}(?:jobs?|roles?|positions?|openings?|applications?))|(?:\bapply\s+(?:to|for)\s+(?:my\s+)?(?:saved|top|best|watchlist)\s+(?:jobs?|roles?|positions?|openings?))|(?:\bstart\s+applying\b)/i

// Intents that require a resolved job context (tailor, workflow, "best job" open)
const NEEDS_JOB_RESOLVE_RE = /\b(tailor|tailor.?my|prepare.?application|prepare.?my.?resume|workflow.*job|open.?strong|strongest.?match|best.?saved|my.?best.*job|best.*matching)\b/i

function inferBulkWorkspaceDirective(message: string): import("@/lib/scout/types").ScoutWorkspaceDirective | undefined {
  if (!BULK_PREP_RE.test(message)) return undefined
  const countMatch = message.match(/\b(\d+)\b/)
  const count = countMatch ? parseInt(countMatch[1], 10) : 10
  const requireSponsorshipSignal = /\b(visa|h-?1b|sponsor)/i.test(message)
  const workMode = /\bremote\b/i.test(message) ? "remote" : undefined
  const strictQuery = /\b(strict\s+query|exact\s+keywords?|all\s+keywords?|must\s+include\s+all)\b/i.test(message)
  const strictScoreOnly = /\b(only\s+scored|scored\s+only|exclude\s+unscored|with\s+scores?\s+only|no\s+null\s+scores?)\b/i.test(message)
  // Matches: "over 80", "above 80", "greater than 80", "more than 80", "> 80", ">= 80", "80 match", "80%"
  const scoreMatch = message.match(
    /\b(?:over|above|greater\s+than|more\s+than|higher\s+than|at\s+least|>=?)\s*(\d+)|(\d+)\s*(?:match|%)\b/i,
  )
  const minMatchScore = scoreMatch ? parseInt(scoreMatch[1] ?? scoreMatch[2], 10) : undefined

  return {
    mode: "bulk_application",
    payload: { count, requireSponsorshipSignal, workMode, minMatchScore, strictQuery, strictScoreOnly },
    chips: [
      "What's my queue status?",
      "Skip jobs with no sponsorship",
      "How do I improve my match scores?",
    ],
  }
}

function inferWorkflowDirective(message: string, intent: ScoutIntent): ScoutWorkflowDirective | undefined {
  if (intent !== "workflow") return undefined
  // Bulk prep is handled by workspace_directive — don't start a single-job workflow
  if (BULK_PREP_RE.test(message)) return undefined
  if (TAILOR_INTENT_RE.test(message)) return { workflowType: "tailor_and_prepare" }
  if (COMPARE_INTENT_RE.test(message)) return { workflowType: "compare_and_prioritize" }
  if (INTERVIEW_INTENT_RE.test(message)) return { workflowType: "interview_prep" }
  return undefined
}

function buildDeterministicScoutResponse(message: string, mode: ScoutMode): ScoutResponse {
  const m = message.toLowerCase()
  const actions: ScoutResponse["actions"] = []

  const worthTimeIntent =
    /\b(worth my time|top match(?:es)?|best match(?:es)?|strong opportunities|prioritize top)\b/i.test(message)
  const sponsorshipIntent =
    /\b(sponsorship|sponsor|h-?1b|visa)\b/i.test(message)
  const filterIntent =
    /\b(filter|show|only|find|prioritize|narrow|focus)\b/i.test(message)

  if (worthTimeIntent) {
    actions.push({
      type: "SET_FOCUS_MODE",
      payload: { enabled: true, reason: "Prioritize strongest matches first" },
      label: "Turn on Focus Mode",
    })
  }

  if (sponsorshipIntent && filterIntent) {
    actions.push({
      type: "APPLY_FILTERS",
      payload: { sponsorship: "high" },
      label: "Filter high sponsorship roles",
    })
  }

  if (/\bremote\b/.test(m) && filterIntent) {
    actions.push({
      type: "APPLY_FILTERS",
      payload: { workMode: "remote" },
      label: "Filter remote jobs",
    })
  } else if (/\bhybrid\b/.test(m) && filterIntent) {
    actions.push({
      type: "APPLY_FILTERS",
      payload: { workMode: "hybrid" },
      label: "Filter hybrid jobs",
    })
  } else if (/\b(on.?site|onsite)\b/.test(m) && filterIntent) {
    actions.push({
      type: "APPLY_FILTERS",
      payload: { workMode: "on-site" },
      label: "Filter on-site jobs",
    })
  }

  if (actions.length > 0) {
    const includesSponsorship = actions.some(
      (a) => a.type === "APPLY_FILTERS" && a.payload.sponsorship === "high",
    )
    const includesFocus = actions.some(
      (a) => a.type === "SET_FOCUS_MODE" && a.payload.enabled,
    )

    const acknowledgements: string[] = []
    if (includesFocus) acknowledgements.push("turned on Focus Mode")
    if (includesSponsorship) acknowledgements.push("filtered to high sponsorship roles")

    return {
      answer:
        acknowledgements.length > 0
          ? `Done — I ${acknowledgements.join(" and ")}.`
          : "Done — applying your feed filters now.",
      recommendation: "Explore",
      actions,
      explanations: [],
      intent: "command",
      confidence: 0.99,
      mode,
    }
  }

  return {
    answer: "Got it — applying that filter now.",
    recommendation: "Explore",
    actions: [],
    explanations: [],
    intent: "command",
    confidence: 0.99,
    mode,
  }
}

// ─────────────────────────────────────────────────────────────────────────────

const DESTRUCTIVE_COMMAND_RE =
  /\b(delete|remove|erase|clear|wipe)\b[\s\S]{0,40}\b(saved jobs|watchlist|applications|profile|resume|data|everything|all)\b/i
const MAX_EXPLANATION_BLOCKS = 4
const MAX_EXPLANATION_ITEMS = 6
const EXPLANATION_BLOCK_TYPES = new Set<ScoutExplanationBlockType>([
  "match_breakdown",
  "resume_gap",
  "sponsorship_signal",
  "application_risk",
  "next_action",
  "evidence_bridge",
])
const EXPLANATION_ITEM_STATUSES = new Set<ScoutExplanationItemStatus>([
  "strong",
  "medium",
  "weak",
  "missing",
  "unknown",
])
const EVIDENCE_BRIDGE_ITEM_STATUSES = new Set<ScoutEvidenceBridgeItemStatus>([
  "strong",
  "partial",
  "missing",
  "unknown",
])

function normalizeConfidence(raw: unknown): number | undefined {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined
  const clamped = Math.max(0, Math.min(1, raw))
  return Number(clamped.toFixed(2))
}

function inferIntentFromMessage(message: string): ScoutIntent {
  const normalized = message.trim()
  // BULK_PREP_RE check must come before ANALYSIS_HINT_RE — phrases like
  // "apply to 2 jobs with match score > 80" contain "score" which would
  // otherwise match ANALYSIS_HINT_RE and produce a non-workflow intent,
  // causing Claude to respond with an analysis answer instead of the
  // bulk-queue confirmation and leaving workspace_directive unset.
  if (BULK_PREP_RE.test(normalized)) return "workflow"
  if (WORKFLOW_HINT_RE.test(normalized)) return "workflow"
  if (COMMAND_VERB_RE.test(normalized)) return "command"
  if (ANALYSIS_HINT_RE.test(normalized)) return "analysis"
  if (QUESTION_HINT_RE.test(normalized)) return "question"
  return "question"
}

function defaultConfidenceForIntent(intent: ScoutIntent): number {
  switch (intent) {
    case "command":
      return 0.84
    case "workflow":
      return 0.8
    case "analysis":
      return 0.76
    case "question":
    default:
      return 0.72
  }
}

function extractRecommendation(text: string): ScoutResponse["recommendation"] {
  const lower = text.toLowerCase()
  const lastParagraph = text.split("\n").slice(-3).join(" ").toLowerCase()

  if (lastParagraph.includes("recommendation:")) {
    if (lastParagraph.includes("apply")) return "Apply"
    if (lastParagraph.includes("skip")) return "Skip"
    if (lastParagraph.includes("improve")) return "Improve"
    if (lastParagraph.includes("wait")) return "Wait"
    if (lastParagraph.includes("explore")) return "Explore"
  }

  if (lower.includes("should apply") || lower.includes("go ahead and apply")) return "Apply"
  if (lower.includes("skip this") || lower.includes("pass on")) return "Skip"
  if (lower.includes("improve your") || lower.includes("update your resume")) return "Improve"
  if (lower.includes("wait until") || lower.includes("timing")) return "Wait"

  return "Explore"
}

/**
 * Strip markdown code fences that Claude sometimes wraps around JSON.
 * Handles both ```json ... ``` and ``` ... ``` variants.
 */
function stripMarkdownCodeFence(text: string): string {
  const fenced = text.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/i)
  if (fenced) return fenced[1].trim()
  return text
}

function extractJsonObjectCandidate(text: string): string | null {
  const cleaned = stripMarkdownCodeFence(text.trim())
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

/**
 * Attempt to build a validated ScoutResponse from a parsed JSON object.
 * Returns null if the shape is wrong.
 */
function buildResponseFromParsed(
  parsed: unknown,
  fallbackMode: ScoutMode,
  fallbackIntent: ScoutIntent,
  safetyNotes: string[]
): ScoutResponse | null {
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("answer" in parsed) ||
    !("recommendation" in parsed) ||
    typeof (parsed as Record<string, unknown>).answer !== "string" ||
    typeof (parsed as Record<string, unknown>).recommendation !== "string" ||
    !["Apply", "Skip", "Improve", "Wait", "Explore"].includes(
      (parsed as Record<string, unknown>).recommendation as string
    )
  ) {
    return null
  }

  const p = parsed as Record<string, unknown>

  const rawActionCount = Array.isArray(p.actions) ? p.actions.length : 0
  const actions = normalizeScoutActions(p.actions)

  const rawExplanationCount = Array.isArray(p.explanations) ? p.explanations.length : 0
  const parsedExplanations =
    "explanations" in p ? parseScoutExplanations(p.explanations) : undefined
  // Always return an array — never undefined
  const explanations: ScoutExplanationBlock[] = parsedExplanations ?? []

  const workflow = "workflow" in p ? parseScoutWorkflow(p.workflow) : undefined
  const intent = isScoutIntent(p.intent) ? p.intent : fallbackIntent
  const confidence =
    normalizeConfidence(p.confidence) ?? defaultConfidenceForIntent(intent)

  if (rawActionCount > actions.length) {
    safetyNotes.push(
      "Some suggested actions were ignored because they were invalid or unsupported."
    )
  }
  if (rawExplanationCount > explanations.length) {
    safetyNotes.push(
      "Some explanation blocks were ignored because they were malformed or exceeded limits."
    )
  }
  if ("workflow" in p && p.workflow !== undefined && !workflow) {
    safetyNotes.push(
      "A suggested workflow was ignored because it did not pass safety validation."
    )
  }

  return {
    answer: p.answer as string,
    recommendation: p.recommendation as ScoutResponse["recommendation"],
    actions,
    explanations,
    workflow,
    intent,
    confidence,
    mode: isScoutMode(p.mode) ? p.mode : fallbackMode,
    interviewPrep: parseInterviewPrep(p.interviewPrep),
    outreach: "outreach" in p ? parseScoutOutreach(p.outreach) : undefined,
  }
}

// ── Outreach draft parser ────────────────────────────────────────────────────

function parseScoutOutreach(raw: unknown): import("@/lib/scout/outreach/types").ScoutOutreachDraft | undefined {
  if (!raw || typeof raw !== "object") return undefined
  const p = raw as Record<string, unknown>
  if (typeof p.draft !== "string" || !p.draft.trim()) return undefined

  const VALID_TYPES  = new Set(["linkedin_message", "email", "follow_up", "referral_request"])
  const VALID_TONES  = new Set(["professional", "warm", "direct"])

  type OutreachType = import("@/lib/scout/outreach/types").ScoutOutreachType
  type OutreachTone = import("@/lib/scout/outreach/types").ScoutOutreachTone

  const parseStrList = (v: unknown, max: number): string[] | undefined => {
    if (!Array.isArray(v)) return undefined
    const strs = v.filter((s): s is string => typeof s === "string" && s.trim().length > 0).slice(0, max)
    return strs.length > 0 ? strs : undefined
  }

  const generatedFrom = typeof p.generatedFrom === "object" && p.generatedFrom !== null
    ? { job: Boolean((p.generatedFrom as Record<string, unknown>).job), resume: Boolean((p.generatedFrom as Record<string, unknown>).resume), companyIntel: Boolean((p.generatedFrom as Record<string, unknown>).companyIntel) }
    : undefined

  return {
    id:            `outreach-${Date.now()}`,
    type:          VALID_TYPES.has(p.type as string) ? p.type as OutreachType : "linkedin_message",
    tone:          VALID_TONES.has(p.tone as string) ? p.tone as OutreachTone : "professional",
    draft:         p.draft.trim().slice(0, 2500),
    talkingPoints: parseStrList(p.talkingPoints, 5),
    warnings:      parseStrList(p.warnings, 2),
    recipientName: typeof p.recipientName === "string" ? p.recipientName.slice(0, 80) : undefined,
    recipientRole: typeof p.recipientRole === "string" ? p.recipientRole.slice(0, 80) : undefined,
    generatedFrom,
  }
}

function parseScoutResponse(
  text: string,
  fallbackMode: ScoutMode,
  fallbackIntent: ScoutIntent
): { response: ScoutResponse; safetyNotes: string[] } {
  const safetyNotes: string[] = []
  const trimmed = text.trim()
  const stripped = stripMarkdownCodeFence(trimmed)

  // Candidates to try in order:
  // 1. stripped as-is — handles normal well-formed JSON
  // 2. "{" + stripped — handles assistant-prefill responses where the opening
  //    brace was pre-seeded and Claude's completion starts from the second char
  const candidates = stripped.startsWith("{")
    ? [stripped]
    : [stripped, "{" + stripped]
  const extractedJson = extractJsonObjectCandidate(trimmed)
  if (extractedJson && !candidates.includes(extractedJson)) {
    candidates.unshift(extractedJson)
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown
      const response = buildResponseFromParsed(parsed, fallbackMode, fallbackIntent, safetyNotes)
      if (response) return { response, safetyNotes }
    } catch {
      // try next candidate
    }
  }

  // Plain-text fallback — always returns arrays so the UI never crashes
  return {
    response: {
      answer: trimmed,
      recommendation: extractRecommendation(trimmed),
      actions: [],
      explanations: [],
      workflow: undefined,
      intent: fallbackIntent,
      confidence: defaultConfidenceForIntent(fallbackIntent),
      mode: fallbackMode,
    },
    safetyNotes,
  }
}

function parseEvidenceBridgeBlock(
  candidate: Record<string, unknown>
): ScoutEvidenceBridgeBlock | null {
  if (!Array.isArray(candidate.items)) return null

  const items: ScoutEvidenceBridgeBlock["items"] = []
  for (const rawItem of candidate.items) {
    if (items.length >= MAX_EXPLANATION_ITEMS) break
    if (!rawItem || typeof rawItem !== "object") continue

    const item = rawItem as Record<string, unknown>
    if (typeof item.requirement !== "string") continue

    const status =
      typeof item.status === "string" &&
      EVIDENCE_BRIDGE_ITEM_STATUSES.has(item.status as ScoutEvidenceBridgeItemStatus)
        ? (item.status as ScoutEvidenceBridgeItemStatus)
        : "unknown"

    items.push({
      requirement: item.requirement,
      resumeEvidence: typeof item.resumeEvidence === "string" ? item.resumeEvidence : undefined,
      status,
      suggestedFix: typeof item.suggestedFix === "string" ? item.suggestedFix : undefined,
    })
  }

  if (items.length === 0) return null

  return {
    type: "evidence_bridge",
    title: typeof candidate.title === "string" ? candidate.title : "Job requirements vs your resume",
    summary: typeof candidate.summary === "string" ? candidate.summary : undefined,
    items,
  }
}

function parseStandardExplanationBlock(
  candidate: Record<string, unknown>
): ScoutStandardExplanationBlock | null {
  if (!Array.isArray(candidate.items)) return null

  const items: ScoutStandardExplanationBlock["items"] = []
  for (const rawItem of candidate.items) {
    if (items.length >= MAX_EXPLANATION_ITEMS) break
    if (!rawItem || typeof rawItem !== "object") continue

    const item = rawItem as Record<string, unknown>
    if (typeof item.label !== "string") continue

    const status =
      typeof item.status === "string" &&
      EXPLANATION_ITEM_STATUSES.has(item.status as ScoutExplanationItemStatus)
        ? (item.status as ScoutExplanationItemStatus)
        : undefined

    items.push({
      label: item.label,
      status,
      evidence: typeof item.evidence === "string" ? item.evidence : undefined,
      recommendation: typeof item.recommendation === "string" ? item.recommendation : undefined,
    })
  }

  if (items.length === 0) return null

  return {
    type: candidate.type as Exclude<ScoutExplanationBlockType, "evidence_bridge">,
    title: candidate.title as string,
    summary: typeof candidate.summary === "string" ? candidate.summary : undefined,
    items,
  }
}

function parseScoutExplanations(raw: unknown): ScoutExplanationBlock[] | undefined {
  if (!Array.isArray(raw)) return undefined

  const normalized: ScoutExplanationBlock[] = []

  for (const block of raw) {
    if (normalized.length >= MAX_EXPLANATION_BLOCKS) break
    if (!block || typeof block !== "object") continue

    const candidate = block as Record<string, unknown>
    if (
      typeof candidate.type !== "string" ||
      !EXPLANATION_BLOCK_TYPES.has(candidate.type as ScoutExplanationBlockType) ||
      typeof candidate.title !== "string"
    ) {
      continue
    }

    if (candidate.type === "evidence_bridge") {
      const parsed = parseEvidenceBridgeBlock(candidate)
      if (parsed) normalized.push(parsed)
    } else {
      const parsed = parseStandardExplanationBlock(candidate)
      if (parsed) normalized.push(parsed)
    }
  }

  return normalized.length > 0 ? normalized : undefined
}

function parseScoutWorkflow(raw: unknown): ScoutWorkflow | undefined {
  if (!raw || typeof raw !== "object") return undefined
  const candidate = raw as Record<string, unknown>
  if (typeof candidate.title !== "string" || !Array.isArray(candidate.steps)) return undefined
  if (candidate.steps.length === 0 || candidate.steps.length > 4) return undefined

  const normalizedSteps: ScoutWorkflow["steps"] = []

  for (const step of candidate.steps) {
    if (!step || typeof step !== "object") return undefined
    const item = step as Record<string, unknown>
    if (typeof item.id !== "string" || typeof item.title !== "string") return undefined

    if ("action" in item && item.action !== undefined) {
      if (!isAllowedScoutAction(item.action)) return undefined
    }

    normalizedSteps.push({
      id: item.id,
      title: item.title,
      description: typeof item.description === "string" ? item.description : undefined,
      action: "action" in item && isAllowedScoutAction(item.action) ? item.action : undefined,
    })
  }

  return {
    title: candidate.title,
    steps: normalizedSteps,
  }
}

function isPremiumScoutAction(action: ScoutResponse["actions"][number]): boolean {
  return action.type === "OPEN_RESUME_TAILOR"
}

function isPremiumWorkflowAction(stepAction: NonNullable<NonNullable<ScoutResponse["workflow"]>["steps"][number]["action"]>): boolean {
  return stepAction.type === "OPEN_RESUME_TAILOR"
}

type KnownScoutIds = {
  jobIds: Set<string>
  companyIds: Set<string>
  resumeIds: Set<string>
}

function getKnownScoutIds(input: {
  bodyJobId?: string
  bodyCompanyId?: string
  bodyResumeId?: string
  contextJobId?: string
  contextCompanyId?: string
  contextResumeId?: string
}): KnownScoutIds {
  const jobIds = new Set<string>()
  const companyIds = new Set<string>()
  const resumeIds = new Set<string>()

  for (const id of [input.bodyJobId, input.contextJobId]) {
    if (id) jobIds.add(id)
  }
  for (const id of [input.bodyCompanyId, input.contextCompanyId]) {
    if (id) companyIds.add(id)
  }
  for (const id of [input.bodyResumeId, input.contextResumeId]) {
    if (id) resumeIds.add(id)
  }

  return { jobIds, companyIds, resumeIds }
}

function isActionUsingKnownIds(action: ScoutResponse["actions"][number], knownIds: KnownScoutIds): boolean {
  switch (action.type) {
    case "APPLY_FILTERS":
    case "SET_FOCUS_MODE":
    case "RESET_CONTEXT":
      // No ID references required — always safe
      return true
    case "OPEN_JOB":
      return knownIds.jobIds.has(action.payload.jobId)
    case "OPEN_COMPANY":
      return knownIds.companyIds.has(action.payload.companyId)
    case "OPEN_RESUME_TAILOR":
      return (
        (action.payload.jobId ? knownIds.jobIds.has(action.payload.jobId) : false) ||
        (action.payload.resumeId ? knownIds.resumeIds.has(action.payload.resumeId) : false)
      )
    case "HIGHLIGHT_JOBS":
      return (
        action.payload.jobIds.length > 0 &&
        action.payload.jobIds.every((jobId) => knownIds.jobIds.has(jobId))
      )
    default:
      return false
  }
}

export async function POST(request: NextRequest) {
  const requestStartedAt = Date.now()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    return scoutError(401, "Unauthorized")
  }

  const body = await request.json().catch(() => ({})) as {
    message?: string
    pagePath?: string
    source?: "mini" | "workspace"
    jobId?: string
    companyId?: string
    resumeId?: string
    applicationId?: string
    /** Explicit job IDs to compare — skips watchlist auto-fetch */
    compareJobIds?: string[]
    /** Current feed state sent from the client so Claude knows what's already active */
    focusMode?: boolean
    activeFilters?: {
      q?: string
      location?: string
      sponsorship?: string
      workMode?: string
    }
    /** Lightweight client-side search profile for soft personalization hints */
    searchProfile?: {
      preferredRoles?: string[]
      preferredLocations?: string[]
      preferredWorkModes?: string[]
      sponsorshipPreference?: string
      companyPreferences?: { liked?: string[] }
    }
    /** When true, return SSE stream instead of JSON */
    stream?: boolean
  }

  const userMessage = body.message?.trim()
  const mode = detectScoutMode(body.pagePath ?? "")
  const requestSource = body.source === "mini" ? "mini" : "workspace"

  if (!userMessage) {
    return scoutError(400, "message is required")
  }

  if (DESTRUCTIVE_COMMAND_RE.test(userMessage)) {
    return NextResponse.json(
      sanitizeScoutResponse({
        answer:
          "I can’t run destructive commands. I can help you review or filter saved jobs, but I won’t delete data from Scout commands.",
        recommendation: "Explore",
        actions: [],
        explanations: [],
        intent: "command",
        confidence: 0.99,
        mode,
      } satisfies ScoutResponse)
    )
  }

  // MiniScout is deterministic-only and does not consume paid Scout credits.
  const routing = routeScoutMessage(userMessage)
  if (requestSource === "mini") {
    if (!routing.useLLM) {
      const deterministicResponse = buildDeterministicScoutResponse(userMessage, mode)
      budgetTracker.record({
        feature: "scout_chat", model: MODEL, tier: inferTier(MODEL),
        inputTokens: 0, outputTokens: 0, latencyMs: 0, costUsd: 0,
        success: true, cached: true, timedOut: false,
        userId: undefined, timestamp: Date.now(),
      })
      return NextResponse.json(sanitizeScoutResponse(deterministicResponse))
    }

    return NextResponse.json(
      sanitizeScoutResponse({
        answer: "Mini Scout only supports quick filters and lookups. Open full Scout for deep analysis.",
        recommendation: "Explore",
        actions: [],
        explanations: [],
        intent: "command",
        confidence: 0.99,
        mode,
      } satisfies ScoutResponse)
    )
  }

  // Every full Scout request counts against a daily message quota
  // (free=5, pro=30, pro_max=60, see lib/usage/quotas.ts). Pro additionally unlocks
  // actions, workflows, and deep analysis via separate gates below.
  const { plan: userPlan } = await getUserPlan(request)
  const isPro = canAccess(userPlan, "scout_actions")

  const quota = await bumpScoutUsage(user.id, userPlan)
  if (quota.exceeded) {
    return NextResponse.json(
      sanitizeScoutResponse({
        answer: isPro
          ? `You've used your ${quota.limit} Scout messages today. Your quota resets at midnight.`
          : `You've used your ${quota.limit} free Scout messages today. Upgrade to Pro for 30 messages a day — plus actions, workflows, and deep analysis.`,
        recommendation: "Wait",
        actions: [],
        explanations: [],
        gated: {
          feature: "scout_actions",
          reason: `Daily Scout message limit (${quota.limit}) reached.`,
          upgradeMessage: isPro
            ? "Quota resets at midnight."
            : "Upgrade to Pro for 30 Scout messages a day.",
        },
      } satisfies ScoutResponse),
      { status: 429 }
    )
  }

  if (!anthropic) {
    return NextResponse.json(
      sanitizeScoutResponse({
        answer: "Scout is temporarily unavailable. The AI service is not configured.",
        recommendation: "Wait",
        actions: [],
        explanations: [],
      } satisfies ScoutResponse),
      { status: 503 }
    )
  }

  // Daily AI spend ceiling. When today's total Anthropic cost crosses the
  // configured cap (AI_DAILY_BUDGET_USD), Scout pauses gracefully instead
  // of running up the bill. Resets at UTC midnight when api_usage rolls.
  if (await isAiBudgetExceeded()) {
    return NextResponse.json(
      sanitizeScoutResponse({
        answer: "Scout's daily AI budget for today has been reached. Try again after midnight UTC — your quota will refresh then.",
        recommendation: "Wait",
        actions: [],
        explanations: [],
        gated: {
          feature: "scout_actions",
          reason: "Daily AI spend cap reached.",
          upgradeMessage: "Quota resets at midnight UTC.",
        },
      } satisfies ScoutResponse),
      { status: 503 }
    )
  }

  // Bulk-prep intent — skip Claude entirely, build response deterministically.
  // Claude would return JSON (per system prompt) which shows as raw text during streaming.
  if (BULK_PREP_RE.test(userMessage)) {
    const bulkDirective = inferBulkWorkspaceDirective(userMessage)
    const bp = bulkDirective?.payload ?? {}
    const countHint  = typeof bp.count === "number" ? bp.count : 10
    const scoreHint  = typeof bp.minMatchScore === "number" ? ` with match score ${bp.minMatchScore}%+` : ""
    const sponsorHint = bp.requireSponsorshipSignal ? " that sponsor H-1B" : ""

    // Query matching jobs server-side
    let applyAgentDirective: import("@/lib/scout/apply-agent/types").ApplyAgentDirective | undefined
    try {
      const params = new URLSearchParams()
      if (bp.minMatchScore)          params.set("minMatchScore", String(bp.minMatchScore))
      if (bp.count)                  params.set("count", String(bp.count))
      if (bp.requireSponsorshipSignal) params.set("sponsorship", "true")
      if (bp.workMode)               params.set("workMode", String(bp.workMode))
      if (bp.strictQuery)            params.set("strictQuery", "true")
      if (bp.strictScoreOnly)        params.set("strictScoreOnly", "true")
      // Pass the full message so apply-agent can free-text search any condition
      params.set("q", userMessage)
      const origin = request.nextUrl.origin || process.env.NEXT_PUBLIC_APP_URL || "http://127.0.0.1:3000"
      const res    = await fetch(`${origin}/api/scout/apply-agent?${params.toString()}`, {
        headers: { cookie: request.headers.get("cookie") ?? "" },
      })
      if (res.ok) {
        const data = await res.json() as { jobs: import("@/lib/scout/apply-agent/types").ApplyAgentJob[] }
        if (data.jobs.length > 0) {
          applyAgentDirective = {
            jobs:     data.jobs,
            criteria: {
              minMatchScore:           bp.minMatchScore as number | undefined,
              requireSponsorshipSignal: Boolean(bp.requireSponsorshipSignal),
              workMode:                bp.workMode as string | undefined,
              strictQuery:             Boolean(bp.strictQuery),
              strictScoreOnly:         Boolean(bp.strictScoreOnly),
              count:                   countHint,
            },
            currentIndex: 0,
            phase:        "select",
          }
        }
      }

      // Fallback: derive queue from saved applications so "apply to N top jobs"
      // still progresses when apply-agent pool selection is too strict.
      if (!applyAgentDirective) {
        const savedRes = await fetch(`${origin}/api/applications?status=saved&limit=200&sort=match_score`, {
          headers: { cookie: request.headers.get("cookie") ?? "" },
        })
        if (savedRes.ok) {
          const savedData = await savedRes.json() as {
            applications?: Array<{
              job_id?: string | null
              job_title?: string | null
              company_name?: string | null
              apply_url?: string | null
              match_score?: number | null
              sponsorship_signal?: string | null
              location?: string | null
              is_remote?: boolean | null
            }>
          }
          const rows = savedData.applications ?? []

          const jobs = rows
            .filter((r) => typeof r.job_id === "string" && r.job_id.length > 0)
            .filter((r) => typeof r.apply_url === "string" && r.apply_url.length > 0)
            .filter((r) => {
              if (typeof bp.minMatchScore === "number") {
                if (bp.strictScoreOnly) return typeof r.match_score === "number" && r.match_score >= bp.minMatchScore
                if (typeof r.match_score === "number") return r.match_score >= bp.minMatchScore
              }
              return true
            })
            .filter((r) => {
              if (!bp.requireSponsorshipSignal) return true
              const sig = (r.sponsorship_signal ?? "").toLowerCase()
              // Keep unknown/likely; drop explicit no-sponsorship signals.
              return !(/\bno\b|\bnone\b|\bnot\b|\bdoes not sponsor\b|\bwithout sponsorship\b/.test(sig))
            })
            .sort((a, b) => (b.match_score ?? -1) - (a.match_score ?? -1))
            .slice(0, countHint)
            .map((r) => ({
              jobId:             r.job_id!,
              jobTitle:          r.job_title ?? "Saved job",
              company:           r.company_name ?? null,
              matchScore:        r.match_score ?? null,
              applyUrl:          r.apply_url ?? null,
              sponsorshipSignal: r.sponsorship_signal ?? null,
              location:          r.location ?? null,
              isRemote:          Boolean(r.is_remote),
              status:            "pending" as const,
            }))

          if (jobs.length > 0) {
            applyAgentDirective = {
              jobs,
              criteria: {
                minMatchScore:            bp.minMatchScore as number | undefined,
                requireSponsorshipSignal: Boolean(bp.requireSponsorshipSignal),
                workMode:                 bp.workMode as string | undefined,
                strictQuery:              Boolean(bp.strictQuery),
                strictScoreOnly:          Boolean(bp.strictScoreOnly),
                count:                    countHint,
              },
              currentIndex: 0,
              phase:        "select",
            }
          }
        }
      }
    } catch { /* non-critical */ }

    const jobCount = applyAgentDirective?.jobs.length ?? 0
    const answer   = jobCount > 0
      ? `I found **${jobCount} job${jobCount !== 1 ? "s" : ""}**${scoreHint}${sponsorHint} in your list. I'll walk you through tailoring and applying to each one — starting with the best match.`
      : `I didn't find any saved jobs${scoreHint}${sponsorHint}. Save some jobs from the feed first, then come back and I'll queue them up for you.`

    const bulkResponse: ScoutResponse = {
      answer,
      recommendation: "Explore",
      actions:        [],
      explanations:   [],
      intent:         "workflow",
      confidence:     0.99,
      mode,
      workspace_directive: bulkDirective,
      apply_agent:    applyAgentDirective,
    }

    // Client always uses stream:true — return SSE so the stream handler can process it
    if (body.stream === true) {
      const enc = new TextEncoder()
      let ctrl!: ReadableStreamDefaultController<Uint8Array>
      const sseStream = new ReadableStream<Uint8Array>({ start: (c) => { ctrl = c } })
      void (async () => {
        try {
          if (bulkDirective) ctrl.enqueue(enc.encode(encodeSSE({ type: "workspace_directive", payload: bulkDirective })))
          ctrl.enqueue(enc.encode(encodeSSE({ type: "response", payload: sanitizeScoutResponse(bulkResponse) })))
          ctrl.enqueue(enc.encode(encodeSSE({ type: "done" })))
        } finally {
          try { ctrl.close() } catch {}
        }
      })()
      return new Response(sseStream, {
        headers: {
          "Content-Type":      "text/event-stream",
          "Cache-Control":     "no-cache, no-transform",
          "Connection":        "keep-alive",
          "X-Accel-Buffering": "no",
        },
      })
    }

    return NextResponse.json(sanitizeScoutResponse(bulkResponse))
  }

  // Deterministic routing gate — no LLM needed for pure UI/filter commands
  if (!routing.useLLM) {
    const deterministicResponse = buildDeterministicScoutResponse(userMessage, mode)
    budgetTracker.record({
      feature: "scout_chat", model: MODEL, tier: inferTier(MODEL),
      inputTokens: 0, outputTokens: 0, latencyMs: 0, costUsd: 0,
      success: true, cached: true, timedOut: false,
      userId: undefined, timestamp: Date.now(),
    })
    return NextResponse.json(sanitizeScoutResponse(deterministicResponse))
  }

  const effectivePlan = userPlan ?? "free"
  const inferredIntent = inferIntentFromMessage(userMessage)

  // TODO(scout-usage): Add persistent free daily usage tracking once storage schema is finalized.
  // For now this is a placeholder and does not enforce a hard/soft quota.
  const premiumGate = findScoutPremiumGate({
    plan: effectivePlan,
    message: userMessage,
    mode,
  })

  const shouldShortCircuitForGate =
    premiumGate &&
    premiumGate.feature !== "scout_strategy" &&
    premiumGate.feature !== "interview_prep"

  if (shouldShortCircuitForGate) {
    return NextResponse.json(
      sanitizeScoutResponse(buildGatedScoutResponse({
        gate: premiumGate,
        mode,
        answer:
          "Here is the free version: focus on your top 2 gaps first, prioritize roles with clear fit signals, and keep decisions simple (apply / improve / skip).",
      }))
    )
  }

  // Detect compare intent to decide whether to auto-fetch watchlist jobs
  const isCompareIntent = COMPARE_HINT_RE.test(userMessage)
  const isInterviewPrepIntent = INTERVIEW_PREP_HINT_RE.test(userMessage)
  const hasExplicitCompareIds =
    Array.isArray(body.compareJobIds) && body.compareJobIds.length >= 2

  // Gate 3+ job comparisons for free users
  if (
    hasExplicitCompareIds &&
    (body.compareJobIds?.length ?? 0) > 2 &&
    !canAccess(effectivePlan, "scout_deep_analysis")
  ) {
    return NextResponse.json(
      sanitizeScoutResponse({
        answer:
          "Free Scout can compare up to 2 jobs. Upgrade to Scout Pro to compare 3 or more jobs with deep analysis.",
        recommendation: "Explore",
        actions: [],
        explanations: [],
        mode,
        gated: {
          feature: "scout_deep_analysis" as const,
          reason: "Comparing 3+ jobs requires Scout Pro deep analysis.",
          upgradeMessage: "Upgrade to unlock multi-job comparison with deep analysis and sponsorship signals.",
        },
      } satisfies ScoutResponse)
    )
  }

  // Cap auto-compare to 2 jobs for free users, 5 for paid
  const compareLimit = canAccess(effectivePlan, "scout_deep_analysis") ? 5 : 2

  // ── Job context resolver ────────────────────────────────────────────────────
  // Detect commands that need a concrete job (tailor, workflow, "best saved job",
  // "open strongest match") and resolve one server-side before calling getScoutContext.
  // This ensures Claude's answer, action payloads, and workspace_directive all
  // reference the same job — never a hallucinated or mismatched ID.
  const needsJobResolve =
    !body.jobId &&                        // no explicit jobId from client
    !BULK_PREP_RE.test(userMessage) &&    // not a bulk-prep command
    NEEDS_JOB_RESOLVE_RE.test(userMessage)

  let resolvedJob: import("@/lib/scout/resolve-job-context").ResolvedJobContext | null = null
  const pool = (await import("@/lib/postgres/server")).getPostgresPool()

  if (needsJobResolve) {
    resolvedJob = await resolveJobContext(user.id, pool, {}).catch(() => null)

    if (process.env.NODE_ENV === "development") {
      console.log("[scout:resolve]", {
        message:      userMessage.slice(0, 60),
        resolvedJobId: resolvedJob?.jobId ?? null,
        source:        resolvedJob?.source ?? null,
        confidence:    resolvedJob?.confidence ?? null,
        detailUrl:     resolvedJob?.detailUrl ?? null,
      })
    }

    // No saved jobs found → return early with a helpful "save a job first" response
    if (!resolvedJob) {
      const topSaved = await listTopSavedJobs(user.id, pool, 5).catch(() => [])
      if (topSaved.length === 0) {
        return NextResponse.json(
          sanitizeScoutResponse({
            answer:
              "I don't see any saved jobs in your list. To tailor your resume or prepare an application, save a job from the feed first — then come back and I can prepare everything for that specific role.",
            recommendation: "Explore",
            actions: [{ type: "APPLY_FILTERS", payload: { sponsorship: "high" }, label: "Find sponsorship-friendly roles" }],
            explanations: [],
            intent: "command",
            confidence: 0.95,
            mode,
          } satisfies ScoutResponse)
        )
      }
      // There are saved jobs but none with a resolved job_id — prompt selection
      const jobList = topSaved
        .map((j, i) => `${i + 1}. **${j.title}** at ${j.company}${j.score ? ` (${j.score}% match)` : ""}`)
        .join("\n")
      return NextResponse.json(
        sanitizeScoutResponse({
          answer: `I found ${topSaved.length} saved job${topSaved.length !== 1 ? "s" : ""}. Which one should I tailor for?\n\n${jobList}\n\nNavigate to the job and open Scout from that page, or tell me which role to target.`,
          recommendation: "Explore",
          actions: [],
          explanations: [],
          intent: "command",
          confidence: 0.9,
          mode,
        } satisfies ScoutResponse)
      )
    }
  }

  // Effective job ID: resolved > explicit body value
  const effectiveJobId = resolvedJob?.jobId ?? body.jobId

  try {
    // Retrieve grounded context (includes active memories via getScoutContext)
    const context = await getScoutContext({
      userId: user.id,
      pagePath: body.pagePath,
      mode,
      jobId: effectiveJobId,
      companyId: body.companyId,
      resumeId: body.resumeId,
      applicationId: body.applicationId,
      compareJobIds: hasExplicitCompareIds ? body.compareJobIds : undefined,
      autoCompare: !hasExplicitCompareIds && isCompareIntent,
      compareLimit,
    })

    // ── Memory relevance filtering ──────────────────────────────────────────────
    // Replace the full memory list with the top-N most relevant to this request
    // so we never bloat the prompt with low-relevance memories.
    if (context.memories.length > 0) {
      const { selectRelevantMemories } = await import("@/lib/scout/memory/retriever")
      context.memories = selectRelevantMemories(context.memories, { mode, message: userMessage })
    }

    const formattedContext = await formatScoutContextForClaude(context)

    // ── Multi-agent orchestrator ────────────────────────────────────────────────
    // Runs specialist agents in parallel after context is loaded.
    // Each agent contributes a context section injected into Claude's prompt.
    // Failures are silent — agents degrade gracefully, never block the response.
    const agentIntent = detectAgentIntent(userMessage)
    const orchestratorResult = await runOrchestrator({
      userId:          user.id,
      message:         userMessage,
      detectedIntent:  agentIntent,
      pool,
      jobId:           effectiveJobId,
      companyId:       body.companyId,
      resumeId:        body.resumeId,
      resume:          context.resume
        ? { id: context.resume.id, topSkills: context.resume.top_skills, skills: context.resume.skills as Record<string, string[]> | null, seniorityLevel: context.resume.seniority_level, summary: context.resume.summary }
        : undefined,
      company:         context.company
        ? { id: context.company.id, name: context.company.name, industry: context.company.industry, size: context.company.size, sponsorsH1b: context.company.sponsors_h1b, sponsorshipConf: context.company.sponsorship_confidence, immigrationProfile: context.company.immigration_profile, hiringHealth: context.company.hiring_health }
        : undefined,
      job:             context.job
        ? { id: context.job.id, title: context.job.title, companyName: context.job.company_name, skills: null, description: context.job.description, sponsorsH1b: context.job.sponsors_h1b }
        : undefined,
      compareJobs:     context.compareJobs ?? undefined,
      preferredRoles:  context.behaviorSignals?.preferredRoles,
      userSkills:      context.behaviorSignals?.commonSkills,
      sponsorshipRequired: context.behaviorSignals?.sponsorshipSensitivity === "high",
    }).catch(() => ({ contextSections: [], enrichments: {}, totalDurationMs: 0, traces: undefined }))

    function attachDebug(response: ScoutResponse): void {
      if (!IS_DEV) return
      response.debug = {
        orchestrator: {
          intent: agentIntent,
          totalDurationMs: orchestratorResult.totalDurationMs,
          traces: orchestratorResult.traces,
        },
        timing: {
          responseMs: Date.now() - requestStartedAt,
        },
      }
    }

    // Append agent context sections to the formatted context (before Claude sees it)
    const agentContextBlock = orchestratorResult.contextSections.join("\n")
    const fullContext = agentContextBlock
      ? `${formattedContext}\n\n${agentContextBlock}`
      : formattedContext
    // ── End multi-agent orchestrator ────────────────────────────────────────────

    // ── Application tracker enrichment ──────────────────────────────────────────
    // Detect queries about applications, priorities, follow-ups, or pipeline status
    // and inject real-time application data so Claude can answer with actual data.
    const isApplicationQuery = /\b(applications?|pipeline|follow.?up|priorities|priority|active|tracker|interviewing|interview|offer|actions?|what should i|next steps?|status)\b/i.test(userMessage)
    let applicationContext = ""
    if (isApplicationQuery) {
      try {
        type AppRow = {
          id: string
          status: string
          job_title: string | null
          company_name: string | null
          applied_at: string | null
          updated_at: string
          match_score: number | null
          notes: string | null
        }
        const appsResult = await pool.query<AppRow>(
          `SELECT id, status, job_title, company_name, applied_at, updated_at, match_score, notes
           FROM job_applications
           WHERE user_id = $1 AND is_archived = false
           ORDER BY
             CASE status
               WHEN 'offered'      THEN 1
               WHEN 'interviewing' THEN 2
               WHEN 'applied'      THEN 3
               WHEN 'saved'        THEN 4
               ELSE 5
             END,
             COALESCE(applied_at, updated_at) DESC
           LIMIT 60`,
          [user.id]
        )
        const apps = appsResult.rows
        if (apps.length > 0) {
          const now = Date.now()
          const daysSince = (d: string | null) =>
            d ? Math.floor((now - new Date(d).getTime()) / 86_400_000) : null

          const offered      = apps.filter(a => a.status === "offered")
          const interviewing = apps.filter(a => a.status === "interviewing")
          const applied      = apps.filter(a => a.status === "applied")
          const saved        = apps.filter(a => a.status === "saved")
          const rejected     = apps.filter(a => a.status === "rejected")

          const agingApplied  = applied.filter(a => (daysSince(a.applied_at) ?? 0) >= 14)
          const recentApplied = applied.filter(a => (daysSince(a.applied_at) ?? 0) < 14)

          const fmt = (a: AppRow, dateField: string | null) => {
            const days = daysSince(dateField)
            const daysStr = days !== null ? ` (${days}d ago)` : ""
            const score = a.match_score ? ` | ${a.match_score}% match` : ""
            const note  = a.notes ? ` | Note: ${a.notes}` : ""
            return `  • ${a.company_name ?? "Unknown"} — ${a.job_title ?? "Role"}${daysStr}${score}${note}`
          }

          const lines: string[] = [
            `Active Application Tracker — LIVE DATA (${apps.length} active):`,
            `Summary: ${offered.length} offer${offered.length !== 1 ? "s" : ""}, ${interviewing.length} interviewing, ${applied.length} applied (${agingApplied.length} aging ≥14d), ${saved.length} saved, ${rejected.length} rejected`,
          ]

          if (offered.length > 0) {
            lines.push("\nOFFERS (decision needed urgently):")
            offered.forEach(a => lines.push(fmt(a, a.applied_at ?? a.updated_at)))
          }
          if (interviewing.length > 0) {
            lines.push("\nINTERVIEWING (stay sharp, follow through):")
            interviewing.forEach(a => lines.push(fmt(a, a.updated_at)))
          }
          if (agingApplied.length > 0) {
            lines.push(`\nAGING APPLICATIONS — applied 14+ days ago, no update (follow-up warranted):`)
            agingApplied.forEach(a => lines.push(fmt(a, a.applied_at)))
          }
          if (recentApplied.length > 0) {
            lines.push("\nRECENT APPLICATIONS (<14 days, let them process):")
            recentApplied.slice(0, 6).forEach(a => lines.push(fmt(a, a.applied_at)))
            if (recentApplied.length > 6) lines.push(`  ... and ${recentApplied.length - 6} more`)
          }
          if (saved.length > 0) {
            const topSaved = [...saved].sort((a, b) => (b.match_score ?? 0) - (a.match_score ?? 0)).slice(0, 4)
            lines.push(`\nSAVED (not yet applied — ${saved.length} total, top by match score):`)
            topSaved.forEach(a => lines.push(fmt(a, null)))
            if (saved.length > 4) lines.push(`  ... and ${saved.length - 4} more saved`)
          }
          applicationContext = lines.join("\n")
        }
      } catch {
        // silent — never block the response
      }
    }

    const enrichedContext = applicationContext
      ? `${fullContext}\n\n${applicationContext}`
      : fullContext
    // ── End application tracker enrichment ──────────────────────────────────────

    // ── Offer negotiation enrichment ─────────────────────────────────────────────
    const { isOfferNegotiationIntent } = await import("@/lib/scout/offer-negotiation-intent")
    const isOfferNegotIntent = isOfferNegotiationIntent(userMessage)
    let offerNegotiationContext = ""

    if (isOfferNegotIntent) {
      try {
        // Fetch the most recent offer-stage application with offer details
        const offerAppResult = await pool.query<{
          id: string
          company_name: string
          job_title: string
          offer_details: {
            base_salary?: number
            equity?: string
            signing_bonus?: number
            annual_bonus_target?: number
            offer_deadline?: string
          } | null
        }>(
          `SELECT id, company_name, job_title, offer_details
           FROM job_applications
           WHERE user_id = $1
             AND status = 'offer'
             AND offer_details IS NOT NULL
             AND offer_details::text != '{}'
           ORDER BY updated_at DESC
           LIMIT 1`,
          [user.id]
        )

        const offerApp = offerAppResult.rows[0]

        if (offerApp?.offer_details?.base_salary) {
          const { analyzeOfferForNegotiation } = await import("@/lib/offers/offer-risk-analyzer")
          const userProfileResult = await pool.query<{
            visa_status: string | null
            top_skills: string[] | null
            desired_locations: string[] | null
          }>(
            `SELECT visa_status, top_skills, desired_locations FROM profiles WHERE id = $1`,
            [user.id]
          )
          const userProf = userProfileResult.rows[0]

          // Find company_id for this application
          const companyResult = await pool.query<{ id: string }>(
            `SELECT id FROM companies WHERE name ILIKE $1 LIMIT 1`,
            [`%${offerApp.company_name}%`]
          )
          const companyId = companyResult.rows[0]?.id ?? ""

          const negotiationAnalysis = await analyzeOfferForNegotiation(
            offerApp.offer_details,
            companyId,
            offerApp.job_title,
            {
              visaStatus: userProf?.visa_status,
              location: userProf?.desired_locations?.[0],
              topSkills: userProf?.top_skills ?? [],
            }
          )

          const { getNegotiationTimeline } = await import("@/lib/offers/negotiation-coach")
          const deadline = offerApp.offer_details.offer_deadline
            ? new Date(offerApp.offer_details.offer_deadline)
            : null
          const timeline = getNegotiationTimeline(deadline, true)

          const na = negotiationAnalysis
          const sa = na.salaryAnalysis
          offerNegotiationContext = [
            `Offer Negotiation Context — LIVE DATA:`,
            `Company: ${offerApp.company_name} | Role: ${offerApp.job_title}`,
            `Offered base salary: ${sa.offered ? `$${sa.offered.toLocaleString()}` : "Not provided"}`,
            `Market P50: $${sa.marketP50.toLocaleString()} | P75: $${sa.marketP75.toLocaleString()} | P90: $${sa.marketP90.toLocaleString()}`,
            `Percentile position: ${sa.percentilePosition}`,
            `Below market: ${sa.isBelowMarket ? "YES" : "No"}`,
            sa.lcaPrevailingWage ? `LCA prevailing wage: $${sa.lcaPrevailingWage.toLocaleString()}` : "",
            `Data source: ${sa.source}`,
            `Recommended counter ask: $${na.counterOfferScript.salaryAsk.toLocaleString()}`,
            `Fallback position: $${na.counterOfferScript.fallbackPosition.toLocaleString()}`,
            `Recommended approach: ${na.negotiationStrategy.recommendedApproach}`,
            na.redFlags.length > 0 ? `Red flags: ${na.redFlags.join(" | ")}` : "",
            na.immigrationConsiderations.length > 0
              ? `Immigration notes: ${na.immigrationConsiderations[0]}`
              : "",
            timeline.daysRemaining !== null
              ? `Offer deadline: ${timeline.deadline} (${timeline.daysRemaining} days remaining — urgency: ${timeline.urgencyLevel})`
              : "",
            `Next step: ${timeline.steps[0]?.action ?? "Review offer details"}`,
          ].filter(Boolean).join("\n")
        } else {
          offerNegotiationContext = [
            `Offer Negotiation Context:`,
            `No offer with salary details found in the user's saved applications.`,
            `To benchmark this offer, ask the user for: base salary offered, role title, company, and location.`,
          ].join("\n")
        }
      } catch {
        // silent — never block the response
      }
    }

    const afterOfferContext = offerNegotiationContext
      ? `${enrichedContext}\n\n${offerNegotiationContext}`
      : enrichedContext

    // ── Salary coaching enrichment ────────────────────────────────────────────────
    const { isSalaryCoachingIntent } = await import("@/lib/scout/salary-coaching-intent")
    const isSalaryCoachIntent = isSalaryCoachingIntent(userMessage)
    let salaryCoachingContext = ""

    if (isSalaryCoachIntent) {
      try {
        const { detectSalaryFloor } = await import("@/lib/scout/salary/floor-detector")
        const floorProfile = await detectSalaryFloor(user.id)

        if (floorProfile.detectedFloor > 0) {
          const lines = [
            `Salary Floor Analysis — LIVE DATA:`,
            `Role context: ${floorProfile.roleContext} | Location: ${floorProfile.locationContext}`,
            `Detected floor (median salary targeted): $${floorProfile.detectedFloor.toLocaleString()}`,
            `Market P50 for this role/location: $${floorProfile.marketFloor.toLocaleString()}`,
            `Gap: $${floorProfile.gap.toLocaleString()} (${floorProfile.gapPercent}%)`,
            `Underselling: ${floorProfile.isUnderselling ? "YES" : "No"}`,
            `Confidence: ${floorProfile.confidence} (based on ${floorProfile.applicationsBelowFloor + floorProfile.applicationsAboveFloor} applications with salary data)`,
            `Applications below market rate: ${floorProfile.applicationsBelowFloor}`,
            `Applications at or above market rate: ${floorProfile.applicationsAboveFloor}`,
            floorProfile.avgOfferedSalary ? `Avg offered salary: $${floorProfile.avgOfferedSalary.toLocaleString()}` : "",
            `Summary: ${floorProfile.evidenceSummary}`,
          ].filter(Boolean).join("\n")
          salaryCoachingContext = lines

          // If the user asked what to say about salary, also generate expectation script
          if (/what\s+(?:should\s+i\s+say|do\s+i\s+say|to\s+say)\s+(?:when|if|about)/i.test(userMessage)) {
            try {
              const userProfileResult = await pool.query<{ visa_status: string | null; desired_locations: string[] | null }>(
                `SELECT visa_status, desired_locations FROM profiles WHERE id = $1`,
                [user.id]
              )
              const up = userProfileResult.rows[0]
              const { generateSalaryExpectationScript } = await import("@/lib/scout/salary/expectation-coach")
              const script = await generateSalaryExpectationScript(
                user.id,
                floorProfile.roleContext,
                up?.desired_locations?.[0] ?? floorProfile.locationContext,
                up?.visa_status ?? "unknown"
              )
              salaryCoachingContext += `\n\nSalary Expectation Script:\n` +
                `Screening answer: ${script.screeningAnswer}\n` +
                `Email answer: ${script.emailAnswer}\n` +
                `Do not say: ${script.doNotSay.slice(0, 3).join(" | ")}\n` +
                `Negotiation room: ${script.negotiationRoom}`
            } catch {
              // Non-blocking
            }
          }
        } else {
          salaryCoachingContext = `Salary Floor Analysis: Not enough application data to compute a salary floor. Ask the user for their role title and location to give market benchmarks.`
        }
      } catch {
        // Silent — never block the response
      }
    }

    const afterSalaryContext = salaryCoachingContext
      ? `${afterOfferContext}\n\n${salaryCoachingContext}`
      : afterOfferContext

    // ── Burnout / pace check-in enrichment ────────────────────────────────────────
    const { isBurnoutCheckinIntent } = await import("@/lib/scout/burnout-checkin-intent")
    const isBurnoutIntent = isBurnoutCheckinIntent(userMessage)

    // Also check: returning user (7+ days absent) — detect from application activity
    let daysSinceLastActivity = 0
    try {
      const actResult = await pool.query<{ last_at: string | null }>(
        `SELECT MAX(COALESCE(applied_at, updated_at))::text AS last_at
         FROM job_applications WHERE user_id = $1`,
        [user.id]
      )
      daysSinceLastActivity = actResult.rows[0]?.last_at
        ? Math.floor((Date.now() - new Date(actResult.rows[0].last_at).getTime()) / 86_400_000)
        : 0
    } catch { /* silent */ }

    const isReturningUser = daysSinceLastActivity >= 7

    let burnoutContext = ""

    if (isBurnoutIntent || isReturningUser) {
      try {
        if (isReturningUser && !isBurnoutIntent) {
          // Return experience — no classification needed
          const { buildReturnExperience } = await import("@/lib/scout/burnout/return-experience")
          const returnExp = await buildReturnExperience(user.id, daysSinceLastActivity)

          burnoutContext = [
            `Search Return Context — user returning after a break:`,
            `Welcome message: ${returnExp.welcomeMessage}`,
            `New matches since last visit: ${returnExp.newMatchesSinceLastVisit.length}`,
            returnExp.newMatchesSinceLastVisit.length > 0
              ? `Top new match: ${returnExp.newMatchesSinceLastVisit[0]?.jobTitle} at ${returnExp.newMatchesSinceLastVisit[0]?.companyName}`
              : "",
            returnExp.cohortUpdatesSinceLastVisit ? `Cohort update: ${returnExp.cohortUpdatesSinceLastVisit}` : "",
            returnExp.applicationStatusUpdates.length > 0
              ? `Application updates: ${returnExp.applicationStatusUpdates.map((u) => `${u.companyName} → ${u.newStatus}`).join(", ")}`
              : "",
            `Suggested first action: ${returnExp.suggestedFirstAction}`,
          ].filter(Boolean).join("\n")
        } else {
          // Active check-in or explicit distress signal — classify and intervene
          const { classifyBurnoutState } = await import("@/lib/scout/burnout/classifier")
          const { executeIntervention } = await import("@/lib/scout/burnout/interventions")

          const burnoutState = await classifyBurnoutState(user.id)
          const intervention = burnoutState.interventionType !== "none"
            ? await executeIntervention(user.id, burnoutState)
            : null

          burnoutContext = [
            `Search Pace Context:`,
            `Current state: ${burnoutState.state} (confidence: ${burnoutState.confidence})`,
            `Days since last application: ${burnoutState.daysSinceLastApplication}`,
            `Velocity trend: ${burnoutState.applicationVelocityTrend}`,
            `Session quality: ${burnoutState.sessionQualityTrend}`,
            intervention
              ? `Recommended message: ${intervention.message}`
              : `Recommendation: ${burnoutState.recommendation}`,
            intervention?.subtext ? `Context: ${intervention.subtext}` : "",
            intervention ? `Suggested action: ${intervention.ctaQuery}` : "",
            intervention?.suppressBulkApply ? `Note: Do not suggest bulk applying right now.` : "",
            burnoutState.interventionType === "rest_suggestion"
              ? `IMPORTANT: This is a rest suggestion — do NOT push jobs or set tasks. Acknowledge and offer to help when they are ready.`
              : "",
          ].filter(Boolean).join("\n")
        }
      } catch {
        // Silent — never block the response
      }
    }

    const afterBurnoutContext = burnoutContext
      ? `${afterSalaryContext}\n\n${burnoutContext}`
      : afterSalaryContext

    // ── Post-hire check-in enrichment ─────────────────────────────────────────────
    let postHireCheckinContext = ""
    try {
      const { getPendingCheckinForUser, buildCheckinOpeningMessage } = await import("@/lib/checkins/delivery-engine")
      const { getCheckinSet } = await import("@/lib/checkins/question-sets")

      const pendingCheckin = await getPendingCheckinForUser(user.id)
      if (pendingCheckin) {
        const set = getCheckinSet(pendingCheckin.checkin_type)
        const firstQuestion = set?.questions[0]

        postHireCheckinContext = [
          `Post-Hire Check-in Context — pending for this user:`,
          `Check-in ID: ${pendingCheckin.id}`,
          `Type: ${pendingCheckin.checkin_type}`,
          `Company: ${pendingCheckin.company_name ?? "their employer"}`,
          `Role: ${pendingCheckin.role_title ?? "their role"}`,
          `Opening message: ${buildCheckinOpeningMessage(pendingCheckin)}`,
          firstQuestion ? `First question to ask: ${firstQuestion.prompt}` : "",
          `Total questions: ${set?.questions.length ?? 0}`,
          `INSTRUCTION: Surface this check-in as the opening message if the user has not explicitly asked about something else. Ask one question at a time. The user can say "skip" or "not now" to dismiss.`,
          `SAVE ENDPOINT: POST /api/scout/checkin with { checkinId, action: "complete", responses: {...} }`,
          `SKIP ENDPOINT: POST /api/scout/checkin with { checkinId, action: "skip" }`,
        ].filter(Boolean).join("\n")
      }
    } catch {
      // Silent — never block the response
    }

    const afterCheckinContext = postHireCheckinContext
      ? `${afterBurnoutContext}\n\n${postHireCheckinContext}`
      : afterBurnoutContext

    // ── Personal brand enrichment ──────────────────────────────────────────────────
    const isBrandIntent = /\b(personal\s+brand|linkedin\s+(?:profile|post|content|visibility|headline|about)|content\s+idea|improve\s+my\s+(?:brand|visibility|profile|linkedin)|build\s+(?:my\s+brand|presence)|visibility\s+score|brand\s+(?:score|audit))\b/i.test(userMessage)

    let brandContext = ""
    if (isBrandIntent) {
      try {
        const { computeVisibilityScore } = await import("@/lib/brand/visibility-scorer")
        const visScore = await computeVisibilityScore(user.id)

        // Pull top audit items
        const brandAuditResult = await pool.query<{ title: string; severity: string; fix_action: string }>(
          `SELECT title, severity, fix_action FROM public.brand_audit_items
           WHERE user_id = $1 AND resolved = false
           ORDER BY CASE severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END
           LIMIT 3`,
          [user.id]
        )

        brandContext = [
          `Brand Visibility Context:`,
          `Score: ${visScore.score}/100 — ${visScore.verdict}`,
          `Activity: ${visScore.breakdown.activity.score}/30 — ${visScore.breakdown.activity.note}`,
          `Profile completeness: ${visScore.breakdown.profileCompleteness.score}/25 — ${visScore.breakdown.profileCompleteness.note}`,
          `Social proof: ${visScore.breakdown.socialProof.score}/25 — ${visScore.breakdown.socialProof.note}`,
          `Community presence: ${visScore.breakdown.communityPresence.score}/20 — ${visScore.breakdown.communityPresence.note}`,
          visScore.isEstimated ? `Note: Score is estimated — no LinkedIn data connected.` : "",
          brandAuditResult.rows.length > 0
            ? `Top fix items: ${brandAuditResult.rows.map((r) => `[${r.severity}] ${r.title} → ${r.fix_action}`).join(" | ")}`
            : "",
          `Direct the user to /dashboard/brand for the full brand hub with content ideas and drafts.`,
        ].filter(Boolean).join("\n")
      } catch {
        // Silent — never block the response
      }
    }

    const finalContext = brandContext
      ? `${afterCheckinContext}\n\n${brandContext}`
      : afterCheckinContext
    // ── End personal brand enrichment ─────────────────────────────────────────────

    if (isInterviewPrepIntent && !context.job) {
      return NextResponse.json(
        sanitizeScoutResponse({
          answer:
            "I need a specific job loaded before I can create interview prep. Open a job page or send a jobId, then ask me again.",
          recommendation: "Explore",
          actions: [],
          explanations: [],
          intent: "analysis",
          confidence: 0.92,
          mode,
        } satisfies ScoutResponse)
      )
    }

    if (isInterviewPrepIntent && context.job && !canAccess(effectivePlan, "interview_prep")) {
      return NextResponse.json(
        sanitizeScoutResponse(buildInterviewPrepPreview({
          jobTitle: context.job.title,
          companyName: context.job.company_name,
          jobId: context.job.id,
          hasResume: Boolean(context.resume),
          hasMatchScore: Boolean(context.matchScore),
          mode,
        }))
      )
    }

    // Build a feed state summary so Claude doesn't suggest already-active things
    const feedStateLines: string[] = []
    if (body.focusMode) {
      feedStateLines.push("- Focus Mode: ON (do NOT suggest SET_FOCUS_MODE with enabled:true — it is already active)")
    } else {
      feedStateLines.push("- Focus Mode: OFF")
    }
    const af = body.activeFilters ?? {}
    const activeFilterEntries = Object.entries(af).filter(([, v]) => !!v)
    if (activeFilterEntries.length > 0) {
      feedStateLines.push(`- Active filters: ${activeFilterEntries.map(([k, v]) => `${k}="${v}"`).join(", ")}`)
    } else {
      feedStateLines.push("- Active filters: none")
    }

    // Build lightweight search profile hint for Claude (client-provided, soft hints only)
    const sp = body.searchProfile
    const searchProfileLines: string[] = []
    if (sp?.sponsorshipPreference && sp.sponsorshipPreference !== "unknown") {
      searchProfileLines.push(`- Sponsorship signal: ${sp.sponsorshipPreference}`)
    }
    if (sp?.preferredWorkModes?.length) {
      searchProfileLines.push(`- Preferred work modes: ${sp.preferredWorkModes.join(", ")}`)
    }
    if (sp?.preferredRoles?.length) {
      searchProfileLines.push(`- Role interests: ${sp.preferredRoles.slice(0, 4).join(", ")}`)
    }
    if (sp?.preferredLocations?.length) {
      searchProfileLines.push(`- Location preference: ${sp.preferredLocations.slice(0, 3).join(", ")}`)
    }
    if (sp?.companyPreferences?.liked?.length) {
      searchProfileLines.push(`- Liked companies/types: ${sp.companyPreferences.liked.slice(0, 3).join(", ")}`)
    }
    const searchProfileSection = searchProfileLines.length > 0
      ? `\nSearch Profile (soft hints — do not over-weight, user message always takes priority):\n${searchProfileLines.join("\n")}\n`
      : ""

    const contextualPrompt = `Active Scout Mode: ${mode}
Current Page Path: ${body.pagePath ?? "Unknown"}
Intent hint from UI/server: ${inferredIntent}

Current Feed State (IMPORTANT — do not suggest actions that are already active):
${feedStateLines.join("\n")}
${searchProfileSection}
Scout Context:
${finalContext}

---

User Input: ${userMessage}`

    // Use more tokens when structured add-ons are present (extra JSON sections in response)
    const maxTokens =
      (context.compareJobs && context.compareJobs.length >= 2) || isInterviewPrepIntent
        ? 1536
        : 1024

    // ── Streaming branch ────────────────────────────────────────────────────────
    // When body.stream === true, run the Anthropic call + post-processing inside
    // a background IIFE, emit SSE events, and return the ReadableStream immediately.
    // The non-streaming path below is completely unchanged.
    if (body.stream === true) {
      const enc = new TextEncoder()
      let ctrl!: ReadableStreamDefaultController<Uint8Array>
      const sseStream = new ReadableStream<Uint8Array>({
        start: (c) => { ctrl = c },
      })
      const emit = (event: import("@/lib/scout/streaming/types").ScoutStreamEvent) => {
        try { ctrl.enqueue(enc.encode(encodeSSE(event))) } catch {}
      }

      const systemPrompt = getScoutSystemPrompt(mode, {
        premiumEnabled: canUsePremiumScoutFeatures(effectivePlan) && !premiumGate,
      })
      // Mark the system prompt for ephemeral (5-minute) prompt caching.
      // The Scout system prompt is large (~500 lines); without this each
      // streaming call pays full input cost for identical preamble bytes.
      const msgParams = {
        model: MODEL,
        max_tokens: maxTokens,
        system: [{ type: "text" as const, text: systemPrompt, cache_control: { type: "ephemeral" as const } }],
        messages: [{ role: "user" as const, content: contextualPrompt }],
      }

      void (async () => {
        const streamStart = Date.now()
        try {
          const rawStream = anthropic.messages.stream(msgParams)
          const { stream, abort: abortStream } = streamWithTimeout(rawStream, AI_TIMEOUTS.scout_chat_stream)
          stream.on("text", (text) => emit({ type: "text_delta", text }))
          let msg: Awaited<ReturnType<typeof stream.finalMessage>>
          try {
            msg = await stream.finalMessage()
          } catch {
            abortStream()
            emit({ type: "error", message: "Scout is taking too long — please try again." })
            budgetTracker.record({ feature: "scout_chat_stream", model: MODEL, tier: inferTier(MODEL), inputTokens: 0, outputTokens: 0, latencyMs: Date.now() - streamStart, costUsd: 0, success: false, cached: false, timedOut: true, timestamp: Date.now() })
            return
          }

          const inputTokens  = msg.usage?.input_tokens  ?? 0
          const outputTokens = msg.usage?.output_tokens ?? 0
          const costUsd = calcCost(inferTier(MODEL), inputTokens, outputTokens)
          budgetTracker.record({ feature: "scout_chat_stream", model: MODEL, tier: inferTier(MODEL), inputTokens, outputTokens, latencyMs: Date.now() - streamStart, costUsd, success: true, cached: false, timedOut: false, timestamp: Date.now() })
          await logApiUsage({ service: "claude", operation: "scout_chat_stream", tokens_used: inputTokens + outputTokens, cost_usd: Number(costUsd.toFixed(6)) })

          const responseText = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim()
          const { response: scoutResponse, safetyNotes } = parseScoutResponse(responseText, mode, inferredIntent)
          if (!isInterviewPrepIntent || !canAccess(effectivePlan, "interview_prep")) scoutResponse.interviewPrep = undefined

          const knownIds = getKnownScoutIds({ bodyJobId: body.jobId, bodyCompanyId: body.companyId, bodyResumeId: body.resumeId, contextJobId: context.job?.id, contextCompanyId: context.company?.id, contextResumeId: context.resume?.id })
          if (resolvedJob) { knownIds.jobIds.add(resolvedJob.jobId); if (resolvedJob.companyId) knownIds.companyIds.add(resolvedJob.companyId) }
          if (context.compareJobs) { for (const cj of context.compareJobs) { knownIds.jobIds.add(cj.id); if (cj.company_id) knownIds.companyIds.add(cj.company_id) } }
          scoutResponse.actions = scoutResponse.actions.filter((action) => isActionUsingKnownIds(action, knownIds))
          if (scoutResponse.workflow?.steps) { scoutResponse.workflow.steps = scoutResponse.workflow.steps.map((step) => ({ ...step, action: step.action && isActionUsingKnownIds(step.action, knownIds) ? step.action : undefined })) }
          if (safetyNotes.length > 0) scoutResponse.answer = `${scoutResponse.answer}\n\nNote: ${safetyNotes.join(" ")}`

          const wfDir = inferWorkflowDirective(userMessage, inferredIntent)
          if (wfDir) {
            const cp: Record<string, unknown> = {}
            const wfJobId = resolvedJob?.jobId ?? body.jobId ?? context.job?.id
            const wfResumeId = body.resumeId ?? context.resume?.id
            if (wfJobId) cp.jobId = wfJobId; if (wfResumeId) cp.resumeId = wfResumeId
            if (resolvedJob) { cp.title = resolvedJob.title; cp.company = resolvedJob.company; cp.detailUrl = resolvedJob.detailUrl; cp.source = resolvedJob.source }
            if (Object.keys(cp).length > 0) wfDir.payload = cp
            scoutResponse.workflow_directive = wfDir
          }
          if (!scoutResponse.workspace_directive) {
            const bulkDir = inferBulkWorkspaceDirective(userMessage)
            if (bulkDir) scoutResponse.workspace_directive = bulkDir
          }
          if (TAILOR_INTENT_RE.test(userMessage) && !BULK_PREP_RE.test(userMessage) && !scoutResponse.workspace_directive) {
            const tjId = resolvedJob?.jobId ?? effectiveJobId ?? context.job?.id
            if (tjId) scoutResponse.workspace_directive = { mode: "tailor", payload: { jobId: tjId, resumeId: body.resumeId ?? context.resume?.id, title: resolvedJob?.title ?? context.job?.title, company: resolvedJob?.company ?? context.job?.company_name, detailUrl: resolvedJob?.detailUrl ?? `/dashboard/jobs/${tjId}`, source: resolvedJob?.source ?? "explicit" } }
          }

          // Compare guard (streaming path) — mirrors the non-streaming guard below
          if (isCompareIntent && context.compareJobs && context.compareJobs.length >= 2) {
            if (!scoutResponse.workspace_directive) scoutResponse.workspace_directive = { mode: "compare" }
            if (!scoutResponse.compare) {
              scoutResponse.compare = {
                summary: scoutResponse.answer?.trim()
                  ? scoutResponse.answer.split(/[.!?]/)[0]?.trim() + "."
                  : `Comparing your ${context.compareJobs.length} saved jobs.`,
                items: context.compareJobs.map((cj) => ({
                  jobId:             cj.id,
                  title:             cj.title,
                  company:           cj.company_name,
                  companyId:         cj.company_id ?? null,
                  matchScore:        cj.match_score ?? null,
                  sponsorshipSignal: cj.sponsors_h1b === true ? "Sponsors H-1B" : cj.sponsors_h1b === false ? "Does not sponsor" : null,
                  salaryRange:       cj.salary_min && cj.salary_max ? `$${Math.round(cj.salary_min / 1000)}k–$${Math.round(cj.salary_max / 1000)}k` : null,
                  location:          cj.is_remote ? "Remote" : (cj.location ?? null),
                  recommendation:    ((cj.match_score ?? 0) >= 50 ? "Good" : "Skip") as "Best" | "Good" | "Risky" | "Skip",
                })),
              }
              for (const cj of context.compareJobs) { if (cj.company_id) knownIds.companyIds.add(cj.company_id) }
            }
          }

          // Interview guard (streaming path) — inject interview workspace_directive
          if (scoutResponse.interviewPrep && !scoutResponse.workspace_directive) {
            scoutResponse.workspace_directive = {
              mode: "interview",
              payload: {
                interviewType: detectInterviewType(userMessage),
                companyName:   context.job?.company_name ?? context.company?.name,
                jobTitle:      context.job?.title,
                jobId:         effectiveJobId,
                companyId:     body.companyId ?? context.company?.id,
              },
              chips: ["Give me a tougher question", "How do I answer compensation?", "Draft a post-interview follow-up"],
            }
          }

          // Outreach guard (streaming path) — mirror of non-streaming guard below
          if (scoutResponse.outreach && !scoutResponse.workspace_directive) {
            const ctxName = context.job?.company_name ?? context.company?.name
            scoutResponse.workspace_directive = {
              mode: "outreach",
              payload: { companyName: ctxName, jobTitle: context.job?.title },
              chips:   ["Make it more concise", "Use a warmer tone", "Prepare a follow-up version"],
            }
          }

          attachDebug(scoutResponse)

          const finalScoutResponse = sanitizeScoutResponse(
            stripProOnlyFieldsForFreeUsers(scoutResponse, userPlan)
          )

          // Emit workspace/workflow directives early so client can morph immediately
          if (finalScoutResponse.workspace_directive) emit({ type: "workspace_directive", payload: finalScoutResponse.workspace_directive })
          if (finalScoutResponse.workflow_directive)  emit({ type: "workflow_directive",  payload: finalScoutResponse.workflow_directive  })

          emit({ type: "response", payload: finalScoutResponse })
          emit({ type: "done" })
        } catch (err) {
          emit({ type: "error", message: err instanceof Error ? err.message : "Scout encountered an error." })
        } finally {
          try { ctrl.close() } catch {}
        }
      })()

      return new Response(sseStream, {
        headers: {
          "Content-Type":  "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          "Connection":    "keep-alive",
          "X-Accel-Buffering": "no",
        },
      })
    }
    // ── End streaming branch ────────────────────────────────────────────────────

    const chatStart = Date.now()
    const chatAbort = new AbortController()
    const chatTimer = setTimeout(() => chatAbort.abort(), AI_TIMEOUTS.scout_chat)
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const anthropicClient = anthropic!
    let message: Anthropic.Message
    try {
      const createParams = {
        model: MODEL,
        max_tokens: maxTokens,
        // Ephemeral prompt caching: identical Scout system prompts reuse
        // the cached tokens across requests within ~5 min, cutting input
        // cost on the large preamble to ~10% of normal.
        system: [{
          type: "text" as const,
          text: getScoutSystemPrompt(mode, { premiumEnabled: canUsePremiumScoutFeatures(effectivePlan) && !premiumGate }),
          cache_control: { type: "ephemeral" as const },
        }],
        messages: [{ role: "user" as const, content: contextualPrompt }],
      }
      message = await anthropicClient.messages.create(createParams, { signal: chatAbort.signal })
    } catch {
      clearTimeout(chatTimer)
      budgetTracker.record({ feature: "scout_chat", model: MODEL, tier: inferTier(MODEL), inputTokens: 0, outputTokens: 0, latencyMs: Date.now() - chatStart, costUsd: 0, success: false, cached: false, timedOut: true, timestamp: Date.now() })
      return scoutError(503, "Scout is taking too long right now. Please try again in a moment.")
    }
    clearTimeout(chatTimer)

    const inputTokens = message.usage?.input_tokens ?? 0
    const outputTokens = message.usage?.output_tokens ?? 0
    const costUsd = calcCost(inferTier(MODEL), inputTokens, outputTokens)
    budgetTracker.record({ feature: "scout_chat", model: MODEL, tier: inferTier(MODEL), inputTokens, outputTokens, latencyMs: Date.now() - chatStart, costUsd, success: true, cached: false, timedOut: false, timestamp: Date.now() })

    await logApiUsage({
      service: "claude",
      operation: "scout_chat",
      tokens_used: inputTokens + outputTokens,
      cost_usd: Number(costUsd.toFixed(6)),
    })

    const responseText = message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim()

    const { response: scoutResponse, safetyNotes } = parseScoutResponse(responseText, mode, inferredIntent)
    if (!isInterviewPrepIntent || !canAccess(effectivePlan, "interview_prep")) {
      scoutResponse.interviewPrep = undefined
    }
    const knownIds = getKnownScoutIds({
      bodyJobId: body.jobId,
      bodyCompanyId: body.companyId,
      bodyResumeId: body.resumeId,
      contextJobId: context.job?.id,
      contextCompanyId: context.company?.id,
      contextResumeId: context.resume?.id,
    })

    // Resolved job is now trusted — add to knownIds so its action survives filtering
    if (resolvedJob) {
      knownIds.jobIds.add(resolvedJob.jobId)
      if (resolvedJob.companyId) knownIds.companyIds.add(resolvedJob.companyId)
    }

    // Add compare job IDs + their company IDs to knownIds
    if (context.compareJobs) {
      for (const cj of context.compareJobs) {
        knownIds.jobIds.add(cj.id)
        if (cj.company_id) knownIds.companyIds.add(cj.company_id)
      }
    }

    // Parse compare response from raw JSON (separate pass, avoids touching main parser)
    if (context.compareJobs && context.compareJobs.length >= 2) {
      try {
        const compareJson = extractJsonObjectCandidate(responseText) ?? stripMarkdownCodeFence(responseText.trim())
        const rawJson = JSON.parse(compareJson) as Record<string, unknown>
        if (rawJson.compare) {
          const compareMap = new Map(context.compareJobs.map((cj) => [cj.id, cj]))
          const parsed = parseCompareResponse(rawJson.compare, knownIds.jobIds)
          if (parsed) {
            // Inject server-side company IDs (not trusted from Claude)
            parsed.items = parsed.items.map((item) => ({
              ...item,
              companyId: compareMap.get(item.jobId)?.company_id ?? null,
            }))
            // Add injected company IDs to knownIds for action validation
            for (const item of parsed.items) {
              if (item.companyId) knownIds.companyIds.add(item.companyId)
            }
            scoutResponse.compare = parsed
          }
        }
      } catch {
        // raw JSON parse failed — compare stays undefined
      }
    }

    const beforeActionCount = scoutResponse.actions.length
    scoutResponse.actions = scoutResponse.actions.filter((action) => isActionUsingKnownIds(action, knownIds))

    const beforeWorkflowActionCount = scoutResponse.workflow
      ? scoutResponse.workflow.steps.filter((step) => step.action).length
      : 0

    if (scoutResponse.workflow) {
      scoutResponse.workflow.steps = scoutResponse.workflow.steps.map((step) => ({
        ...step,
        action: step.action && isActionUsingKnownIds(step.action, knownIds) ? step.action : undefined,
      }))
    }

    if (beforeActionCount > scoutResponse.actions.length) {
      safetyNotes.push(
        "Some actions were omitted because required IDs were missing from the current page context."
      )
    }
    if (
      scoutResponse.workflow &&
      beforeWorkflowActionCount >
        scoutResponse.workflow.steps.filter((step) => step.action).length
    ) {
      safetyNotes.push(
        "Some workflow actions were omitted because required IDs were missing from the current page context."
      )
    }

    if (!canUseAdvancedScoutActions(effectivePlan)) {
      const removedPremiumAction = scoutResponse.actions.some((action) => isPremiumScoutAction(action))
      scoutResponse.actions = scoutResponse.actions.filter((action) => !isPremiumScoutAction(action))

      if (removedPremiumAction) {
        scoutResponse.gated = {
          feature: "scout_actions",
          reason: "Resume tailoring action is part of paid Scout actions.",
          upgradeMessage: "Upgrade to unlock resume tailoring shortcuts from Scout.",
        }
      }
    }

    if (scoutResponse.workflow && !canUseAdvancedScoutActions(effectivePlan)) {
      const hadPremiumWorkflowAction = scoutResponse.workflow.steps.some(
        (step) => step.action && isPremiumWorkflowAction(step.action)
      )
      scoutResponse.workflow.steps = scoutResponse.workflow.steps.map((step) => ({
        ...step,
        action:
          step.action && isPremiumWorkflowAction(step.action)
            ? undefined
            : step.action,
      }))

      if (hadPremiumWorkflowAction && !scoutResponse.gated) {
        scoutResponse.gated = {
          feature: "scout_actions",
          reason: "Some workflow actions are part of paid Scout actions.",
          upgradeMessage: "Upgrade to unlock advanced workflow actions like resume tailoring.",
        }
      }
    }

    if (premiumGate?.feature === "scout_strategy" && !scoutResponse.gated) {
      scoutResponse.gated = premiumGate
    }

    if (safetyNotes.length > 0) {
      scoutResponse.answer = `${scoutResponse.answer}\n\nNote: ${safetyNotes.join(" ")}`
    }

    // Inject workflow_directive when the intent is workflow and keywords match a known type.
    // This is server-side inference — Claude does not emit this field directly.
    const workflowDirective = inferWorkflowDirective(userMessage, inferredIntent)
    if (workflowDirective) {
      // Always seed workflow payload with the resolved (or explicit) job context.
      // This ensures the tailor step in tailor_and_prepare has a real jobId — never blank.
      const ctxPayload: Record<string, unknown> = {}
      const wfJobId  = resolvedJob?.jobId ?? body.jobId ?? context.job?.id
      const wfResumeId = body.resumeId ?? context.resume?.id
      if (wfJobId)    ctxPayload.jobId    = wfJobId
      if (wfResumeId) ctxPayload.resumeId = wfResumeId
      if (resolvedJob) {
        ctxPayload.title    = resolvedJob.title
        ctxPayload.company  = resolvedJob.company
        ctxPayload.detailUrl = resolvedJob.detailUrl
        ctxPayload.source   = resolvedJob.source
      }
      if (Object.keys(ctxPayload).length > 0) workflowDirective.payload = ctxPayload
      scoutResponse.workflow_directive = workflowDirective
    }

    // Ensure every OPEN_RESUME_TAILOR action carries the resolved job ID.
    // Claude may return no jobId or a hallucinated one — override with the resolved one.
    if (resolvedJob || effectiveJobId) {
      const resolvedJobId = resolvedJob?.jobId ?? effectiveJobId
      scoutResponse.actions = scoutResponse.actions.map((action) => {
        if (action.type !== "OPEN_RESUME_TAILOR") return action
        return {
          ...action,
          payload: {
            ...action.payload,
            jobId: action.payload.jobId ?? resolvedJobId,
          },
        }
      })
      // Also patch workflow steps that have OPEN_RESUME_TAILOR
      if (scoutResponse.workflow?.steps) {
        scoutResponse.workflow.steps = scoutResponse.workflow.steps.map((step) => {
          if (step.action?.type !== "OPEN_RESUME_TAILOR") return step
          return {
            ...step,
            action: {
              ...step.action,
              payload: {
                ...step.action.payload,
                jobId: step.action.payload.jobId ?? resolvedJobId,
              },
            },
          }
        })
      }
    }

    // Compare guard: when compare context was loaded and compare intent fired, always
    // activate compare mode — even if Claude returned APPLY_FILTERS instead of compare.
    // Claude sometimes decides "your jobs are poor fits, let me redirect to search" and
    // omits the compare field; we still need to show the comparison the user asked for.
    if (isCompareIntent && context.compareJobs && context.compareJobs.length >= 2) {
      if (!scoutResponse.workspace_directive) {
        scoutResponse.workspace_directive = { mode: "compare" }
      }
      // If Claude omitted the compare field entirely, build a minimal fallback comparison
      // from the context jobs so CompareMode has something to render.
      if (!scoutResponse.compare) {
        scoutResponse.compare = {
          summary: scoutResponse.answer?.trim()
            ? scoutResponse.answer.split(/[.!?]/)[0]?.trim() + "."
            : `Here is a comparison of your ${context.compareJobs.length} saved jobs.`,
          items: context.compareJobs.map((cj) => ({
            jobId:              cj.id,
            title:              cj.title,
            company:            cj.company_name,
            companyId:          cj.company_id ?? null,
            matchScore:         cj.match_score ?? null,
            sponsorshipSignal:  cj.sponsors_h1b === true ? "Sponsors H-1B" : cj.sponsors_h1b === false ? "Does not sponsor" : null,
            salaryRange:        cj.salary_min && cj.salary_max
              ? `$${Math.round(cj.salary_min / 1000)}k–$${Math.round(cj.salary_max / 1000)}k`
              : null,
            location:           cj.is_remote ? "Remote" : (cj.location ?? null),
            recommendation:     (cj.match_score ?? 0) >= 75 ? "Good" : (cj.match_score ?? 0) >= 50 ? "Good" : "Skip" as "Best" | "Good" | "Risky" | "Skip",
          })),
        }
        // Add injected company IDs so they survive the knownIds filter
        for (const cj of context.compareJobs) {
          if (cj.company_id) knownIds.companyIds.add(cj.company_id)
        }
      }
    }

    // Inject tailor workspace_directive with full resolved job payload.
    // This ensures TailorMode shows the correct title/company/detailUrl.
    if (!scoutResponse.workspace_directive && TAILOR_INTENT_RE.test(userMessage) && !BULK_PREP_RE.test(userMessage)) {
      const tailorJobId = resolvedJob?.jobId ?? effectiveJobId ?? context.job?.id
      if (tailorJobId) {
        scoutResponse.workspace_directive = {
          mode: "tailor",
          payload: {
            jobId:    tailorJobId,
            resumeId: body.resumeId ?? context.resume?.id,
            title:    resolvedJob?.title ?? context.job?.title,
            company:  resolvedJob?.company ?? context.job?.company_name,
            detailUrl: resolvedJob?.detailUrl ?? (tailorJobId ? `/dashboard/jobs/${tailorJobId}` : undefined),
            source:   resolvedJob?.source ?? "explicit",
          },
        }
      }
    }

    // Inject bulk workspace directive + query matching jobs when bulk-prep intent fires.
    // Also handles the case where Claude's response independently sets bulk_application
    // mode (e.g. for commands the regex didn't catch) — we still fetch jobs for it.
    const needsBulkJobs =
      !scoutResponse.apply_agent &&
      (scoutResponse.workspace_directive?.mode === "bulk_application" ||
        inferBulkWorkspaceDirective(userMessage) !== undefined)

    if (!scoutResponse.workspace_directive) {
      const bulkDirective = inferBulkWorkspaceDirective(userMessage)
      if (bulkDirective) scoutResponse.workspace_directive = bulkDirective
    }

    if (needsBulkJobs && scoutResponse.workspace_directive?.mode === "bulk_application") {
      const bp = scoutResponse.workspace_directive.payload ?? {}
      try {
        const params = new URLSearchParams()
        if (bp.minMatchScore) params.set("minMatchScore", String(bp.minMatchScore))
        if (bp.count)         params.set("count", String(bp.count))
        if (bp.requireSponsorshipSignal) params.set("sponsorship", "true")
        if (bp.workMode)      params.set("workMode", String(bp.workMode))
        if (bp.strictQuery)   params.set("strictQuery", "true")
        if (bp.strictScoreOnly) params.set("strictScoreOnly", "true")
        params.set("q", userMessage)

        const origin = request.nextUrl.origin || process.env.NEXT_PUBLIC_APP_URL || "http://127.0.0.1:3000"
        const res = await fetch(`${origin}/api/scout/apply-agent?${params.toString()}`, {
          headers: { cookie: request.headers.get("cookie") ?? "" },
        })
        if (res.ok) {
          const data = await res.json() as { jobs: import("@/lib/scout/apply-agent/types").ApplyAgentJob[] }
          if (data.jobs.length > 0) {
            scoutResponse.apply_agent = {
              jobs:     data.jobs,
              criteria: {
                minMatchScore:           bp.minMatchScore as number | undefined,
                requireSponsorshipSignal: Boolean(bp.requireSponsorshipSignal),
                workMode:                bp.workMode as string | undefined,
                strictQuery:             Boolean(bp.strictQuery),
                strictScoreOnly:         Boolean(bp.strictScoreOnly),
                count:                   (bp.count as number | undefined) ?? 5,
              },
              currentIndex: 0,
              phase:        "select",
            }
          }
        }
      } catch {
        // Non-critical — UI falls back to BulkApplicationMode
      }
    }

    // Ensure interview mode is set whenever interviewPrep was generated.
    if (scoutResponse.interviewPrep && !scoutResponse.workspace_directive) {
      scoutResponse.workspace_directive = {
        mode: "interview",
        payload: {
          interviewType: detectInterviewType(userMessage),
          companyName:   context.job?.company_name ?? context.company?.name,
          jobTitle:      context.job?.title,
          jobId:         effectiveJobId,
          companyId:     body.companyId ?? context.company?.id,
        },
        chips: ["Give me a tougher question", "How do I answer compensation?", "Draft a post-interview follow-up"],
      }
    }

    // Ensure outreach mode is set whenever an outreach draft was generated.
    // Claude may forget the workspace_directive even when it produces the outreach field.
    if (scoutResponse.outreach && !scoutResponse.workspace_directive) {
      const contextName = context.job?.company_name ?? context.company?.name
      scoutResponse.workspace_directive = {
        mode: "outreach",
        payload: {
          companyName: contextName,
          jobTitle:    context.job?.title,
        },
        chips: ["Make it more concise", "Use a warmer tone", "Prepare a follow-up version"],
      }
    }

    attachDebug(scoutResponse)

    // ── Async memory extraction (fire-and-forget) ────────────────────────────
    // Extract new memory candidates from this chat turn and persist those that
    // clear the confidence threshold. Never blocks the response.
    void (async () => {
      try {
        const { extractFromChatTurn } = await import("@/lib/scout/memory/extractor")
        const { persistCandidates }   = await import("@/lib/scout/memory/store")
        const candidates = extractFromChatTurn(userMessage, scoutResponse)
        if (candidates.length > 0) {
          await persistCandidates(user.id, pool, candidates)
        }
      } catch {
        // Memory extraction is non-critical — never let it surface as an error
      }
    })()

    return NextResponse.json(
      sanitizeScoutResponse(stripProOnlyFieldsForFreeUsers(scoutResponse, userPlan))
    )
  } catch (error) {
    console.error("Scout chat error:", error)

    return NextResponse.json(
      {
        ok: false,
        status: 500,
        message: "I encountered an error processing your request. Please try again in a moment.",
        answer: "I encountered an error processing your request. Please try again in a moment.",
        recommendation: "Wait",
        actions: [],
        explanations: [],
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    )
  }
}
