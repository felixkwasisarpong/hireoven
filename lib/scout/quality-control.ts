/**
 * Scout Quality Control Layer V1
 *
 * A lightweight, synchronous validation + repair pass that runs on every
 * ScoutResponse before it reaches the UI.
 *
 * Designed to be:
 *   - Fast (no I/O, no async, no LLM calls)
 *   - Non-blocking (always returns a safe response, even when issues are found)
 *   - Transparent (logs issues in dev, attaches them to the result for tracing)
 *
 * The 10 rules:
 *   1. No raw JSON exposed as visible text
 *   2. Job-link actions reference valid-looking IDs (UUID format)
 *   3. Tailor actions carry at least a jobId or resumeId
 *   4. Autofill actions are gated on form context being present
 *   5. Visa / sponsorship certainty claims require supporting evidence
 *   6. "Top Applicant" language requires supporting signal
 *   7. workspace_directive is never set on an empty / fallback answer
 *   8. No destructive resets suggested without user intent
 *   9. Fake-certainty language is softened
 *  10. Duplicate or directly-conflicting actions are deduplicated
 */

import type { ScoutResponse, ScoutAction } from "./types"
import { getScoutDisplayText, isRawJson } from "./display-text"

// ── Context ───────────────────────────────────────────────────────────────────

/**
 * Lightweight context flags passed by the call site.
 * All fields are optional — absent flags disable the corresponding check.
 */
export type QCContext = {
  /** True when the active page has a detected application form with fields */
  hasFormFields?: boolean
  /** Server-side sponsorship flag for the active job (null = unknown) */
  sponsorsH1b?: boolean | null
  /** Whether LCA/H-1B filing data exists for this employer */
  hasImmigrationData?: boolean
  /** Whether a visa language string was found in the JD */
  visaLanguageDetected?: string | null
  /** Whether a match score / top-applicant signal exists for this job */
  hasMatchScore?: boolean
  /** Whether the user explicitly requested a destructive reset */
  userRequestedReset?: boolean
  /** "dashboard" | "mini" | "extension" — affects some rule thresholds */
  renderContext?: "dashboard" | "mini" | "extension"
}

// ── Result ────────────────────────────────────────────────────────────────────

export type QCResult = {
  /** True when no issues were found (response passed all rules cleanly) */
  valid: boolean
  /** Human-readable description of each issue detected */
  issues: string[]
  /** The (possibly repaired) response that is safe to render */
  safeResponse: ScoutResponse
}

// ── Constants ─────────────────────────────────────────────────────────────────

const IS_DEV = process.env.NODE_ENV === "development"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Patterns that indicate a high-certainty predictive claim
const FAKE_CERTAINTY_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\b(you('re| are) guaranteed\b)/gi,                  replacement: "you have a strong chance" },
  { pattern: /\b(guaranteed\s+(?:to get|to receive|an offer))/gi,  replacement: "likely to receive" },
  { pattern: /\b(100%\s+(?:certain|sure|confident|you will))/gi,   replacement: "very likely" },
  { pattern: /\b(you\s+will\s+definitely\s+(?:get|land|receive))/gi, replacement: "you may well" },
  { pattern: /\b(no\s+doubt\s+(?:you'll|you will|that you))/gi,    replacement: "it's likely that" },
  { pattern: /\b(certain\s+to\s+(?:get|land|receive|be\s+hired))/gi, replacement: "well-positioned to" },
  { pattern: /\b(absolutely\s+(?:certain|sure)\s+(?:you|this))/gi, replacement: "very likely" },
]

// Patterns indicating high-certainty visa sponsorship language
const CERTAINTY_VISA_PATTERNS: RegExp[] = [
  /\b(confirmed\s+(?:H[-\s]?1B\s+)?sponsor)/i,
  /\b(definitely\s+sponsors?)/i,
  /\b(will\s+(?:definitely\s+)?sponsor\s+(?:you|your\s+visa))/i,
  /\b(100%\s+(?:sponsors?|H[-\s]?1B))/i,
  /\b(guaranteed\s+sponsorship)/i,
]

// "Top applicant" claim patterns
const TOP_APPLICANT_PATTERNS: RegExp[] = [
  /\byou(?:'re|\s+are)\s+a\s+top\s+applicant\b/i,
  /\byou(?:'re|\s+are)\s+(?:among\s+)?the\s+top\s+(?:applicant|candidate)s?\b/i,
  /\bstand(?:ing)?\s+out\s+as\s+(?:a\s+)?top\b/i,
  /\byou(?:'d|\s+would)\s+be\s+a\s+(?:strong\s+)?top\s+applicant\b/i,
]

// Reset phrases that warrant extra scrutiny
const DESTRUCTIVE_RESET_PATTERNS: RegExp[] = [
  /\b(clear(?:ing)?\s+(?:all\s+)?(?:your\s+)?(?:filters|context|history|saved|everything))\b/i,
  /\b(wipe\s+(?:your\s+)?(?:data|profile|history))\b/i,
  /\b(delete\s+(?:all\s+)?(?:your\s+)?(?:saved|applications|jobs|data))\b/i,
]

// Minimum non-trivial answer length — shorter answers shouldn't drive workspace mode changes
const MIN_ANSWER_FOR_WORKSPACE_DIRECTIVE = 20

// ── Rule helpers ──────────────────────────────────────────────────────────────

function cloneResponse(r: ScoutResponse): ScoutResponse {
  return JSON.parse(JSON.stringify(r)) as ScoutResponse
}

function deduplicateActions(actions: ScoutAction[]): { deduped: ScoutAction[]; removed: number } {
  const seen = new Map<string, boolean>()
  const deduped: ScoutAction[] = []
  let removed = 0

  // Detect direct conflicts first: SET_FOCUS_MODE true + false
  const focusModes = actions.filter((a) => a.type === "SET_FOCUS_MODE") as Array<
    Extract<ScoutAction, { type: "SET_FOCUS_MODE" }>
  >
  const hasConflictingFocus =
    focusModes.length >= 2 &&
    focusModes.some((a) => a.payload.enabled) &&
    focusModes.some((a) => !a.payload.enabled)

  for (const action of actions) {
    // Resolve conflicts: keep only the last SET_FOCUS_MODE if there are conflicting ones
    if (hasConflictingFocus && action.type === "SET_FOCUS_MODE") {
      removed++
      continue
    }

    // Dedup by stable key
    const key = actionDedupKey(action)
    if (seen.has(key)) {
      removed++
      continue
    }
    seen.set(key, true)
    deduped.push(action)
  }

  return { deduped, removed }
}

function actionDedupKey(action: ScoutAction): string {
  switch (action.type) {
    case "OPEN_JOB":
      return `open_job:${action.payload.jobId}`
    case "OPEN_COMPANY":
      return `open_company:${action.payload.companyId}`
    case "OPEN_RESUME_TAILOR":
      return `tailor:${action.payload.jobId ?? ""}:${action.payload.resumeId ?? ""}`
    case "HIGHLIGHT_JOBS":
      return `highlight:${[...action.payload.jobIds].sort().join(",")}`
    case "APPLY_FILTERS":
      return `filters:${JSON.stringify(action.payload)}`
    case "SET_FOCUS_MODE":
      return `focus:${action.payload.enabled}`
    case "RESET_CONTEXT":
      return `reset:${action.payload.clearFilters ?? false}`
    default:
      return `${action.type}:${JSON.stringify((action as { payload?: unknown }).payload ?? {})}`
  }
}

function softtenCertaintyLanguage(text: string): { softened: string; changed: boolean } {
  let result = text
  let changed = false
  for (const { pattern, replacement } of FAKE_CERTAINTY_PATTERNS) {
    const next = result.replace(pattern, replacement)
    if (next !== result) { result = next; changed = true }
  }
  return { softened: result, changed }
}

// ── Main QC function ──────────────────────────────────────────────────────────

export function runQualityControl(
  response: ScoutResponse,
  context: QCContext = {},
): QCResult {
  const issues: string[] = []
  const safe = cloneResponse(response)

  // ── Rule 1: No raw JSON in answer ─────────────────────────────────────────
  if (safe.answer && isRawJson(safe.answer)) {
    issues.push("R1: answer contains raw JSON — replaced with display-safe text")
    safe.answer = getScoutDisplayText(safe.answer)
    // If getScoutDisplayText still returns JSON (double-wrapped), replace with fallback
    if (isRawJson(safe.answer) || !safe.answer.trim()) {
      safe.answer = "Scout prepared a structured response — see the cards and actions below."
    }
  }

  // ── Rule 2: Job-link actions reference valid-looking IDs ──────────────────
  safe.actions = safe.actions.filter((action) => {
    if (action.type === "OPEN_JOB") {
      const id = (action as Extract<ScoutAction, { type: "OPEN_JOB" }>).payload.jobId
      if (!UUID_RE.test(id)) {
        issues.push(`R2: OPEN_JOB action removed — jobId "${id}" is not a valid UUID`)
        return false
      }
    }
    if (action.type === "OPEN_COMPANY") {
      const id = (action as Extract<ScoutAction, { type: "OPEN_COMPANY" }>).payload.companyId
      if (!UUID_RE.test(id)) {
        issues.push(`R2: OPEN_COMPANY action removed — companyId "${id}" is not a valid UUID`)
        return false
      }
    }
    if (action.type === "HIGHLIGHT_JOBS") {
      const ids = (action as Extract<ScoutAction, { type: "HIGHLIGHT_JOBS" }>).payload.jobIds
      const allValid = ids.every((id) => UUID_RE.test(id))
      if (!allValid) {
        issues.push(`R2: HIGHLIGHT_JOBS action removed — one or more jobIds are not valid UUIDs`)
        return false
      }
    }
    if (action.type === "OPEN_RESUME_TAILOR") {
      const p = (action as Extract<ScoutAction, { type: "OPEN_RESUME_TAILOR" }>).payload
      const jobIdOk = !p.jobId || UUID_RE.test(p.jobId)
      const resumeIdOk = !p.resumeId || UUID_RE.test(p.resumeId)
      if (!jobIdOk || !resumeIdOk) {
        issues.push(`R2: OPEN_RESUME_TAILOR action removed — ID format invalid`)
        return false
      }
    }
    return true
  })

  // Rule 2 also applies to workflow steps
  if (safe.workflow?.steps) {
    safe.workflow.steps = safe.workflow.steps.map((step) => {
      if (!step.action) return step
      const action = step.action
      if (action.type === "OPEN_JOB") {
        const id = (action as Extract<ScoutAction, { type: "OPEN_JOB" }>).payload.jobId
        if (!UUID_RE.test(id)) {
          issues.push(`R2: workflow step OPEN_JOB removed — jobId "${id}" not a valid UUID`)
          return { ...step, action: undefined }
        }
      }
      return step
    })
  }

  // ── Rule 3: Tailor actions should carry at least a jobId ─────────────────
  // (resumeId alone is not enough for a meaningful tailor action)
  safe.actions = safe.actions.filter((action) => {
    if (action.type === "OPEN_RESUME_TAILOR") {
      const p = (action as Extract<ScoutAction, { type: "OPEN_RESUME_TAILOR" }>).payload
      if (!p.jobId) {
        issues.push("R3: OPEN_RESUME_TAILOR removed — no jobId present (cannot tailor without a job)")
        return false
      }
    }
    if (action.type === "PREPARE_TAILORED_AUTOFILL") {
      const p = (action as Extract<ScoutAction, { type: "PREPARE_TAILORED_AUTOFILL" }>).payload
      if (!p.jobId && !p.url) {
        issues.push("R3: PREPARE_TAILORED_AUTOFILL removed — no jobId or URL")
        return false
      }
    }
    return true
  })

  // ── Rule 4: Autofill actions only when form context exists ────────────────
  // Only enforce when the caller has explicitly told us no form was found.
  if (context.hasFormFields === false) {
    const autofillTypes = new Set(["OPEN_EXTENSION_AUTOFILL_PREVIEW", "PREPARE_TAILORED_AUTOFILL"])
    const removed = safe.actions.filter((a) => autofillTypes.has(a.type))
    if (removed.length > 0) {
      safe.actions = safe.actions.filter((a) => !autofillTypes.has(a.type))
      issues.push(`R4: ${removed.length} autofill action(s) removed — no form fields detected on this page`)
    }
  }

  // ── Rule 5: Visa certainty claims require supporting evidence ─────────────
  const hasSponsorshipEvidence =
    context.sponsorsH1b === true ||
    context.hasImmigrationData === true ||
    Boolean(context.visaLanguageDetected)

  if (!hasSponsorshipEvidence && safe.answer) {
    for (const pattern of CERTAINTY_VISA_PATTERNS) {
      if (pattern.test(safe.answer)) {
        // Soften: replace high-certainty phrase with hedged equivalent
        safe.answer = safe.answer
          .replace(/\bconfirmed\s+(?:H[-\s]?1B\s+)?sponsor\b/gi, "may sponsor H-1B (unverified)")
          .replace(/\bdefinitely\s+sponsors?\b/gi, "may sponsor")
          .replace(/\bwill\s+(?:definitely\s+)?sponsor\s+(?:you|your\s+visa)\b/gi, "may be able to sponsor")
          .replace(/\b100%\s+(?:sponsors?|H[-\s]?1B)\b/gi, "may sponsor (unverified)")
          .replace(/\bguaranteed\s+sponsorship\b/gi, "potential sponsorship")
        issues.push("R5: high-certainty visa claim softened — no verified sponsorship evidence in context")
        break
      }
    }
  }

  // ── Rule 6: "Top Applicant" requires a match score signal ─────────────────
  const hasTopApplicantEvidence = context.hasMatchScore === true
  if (!hasTopApplicantEvidence && safe.answer) {
    const hasTopApplicantClaim = TOP_APPLICANT_PATTERNS.some((p) => p.test(safe.answer))
    if (hasTopApplicantClaim) {
      safe.answer = safe.answer
        .replace(/\byou(?:'re|\s+are)\s+a\s+top\s+applicant\b/gi, "you have a strong profile for this role")
        .replace(/\byou(?:'re|\s+are)\s+(?:among\s+)?the\s+top\s+(?:applicant|candidate)s?\b/gi, "you're a strong candidate")
        .replace(/\byou(?:'d|\s+would)\s+be\s+a\s+(?:strong\s+)?top\s+applicant\b/gi, "you could be a strong candidate")
      issues.push("R6: 'top applicant' claim softened — no match score evidence in context")
    }
  }

  // ── Rule 7: workspace_directive only on substantive answers ──────────────
  const effectiveAnswer = safe.answer?.trim() ?? ""
  if (
    safe.workspace_directive &&
    safe.workspace_directive.mode !== "bulk_application" &&
    effectiveAnswer.length < MIN_ANSWER_FOR_WORKSPACE_DIRECTIVE &&
    safe.actions.length === 0 &&
    !safe.compare &&
    !safe.workflow
  ) {
    issues.push(
      `R7: workspace_directive (mode="${safe.workspace_directive.mode}") removed — answer is too short to justify a workspace transition`,
    )
    safe.workspace_directive = undefined
  }

  // ── Rule 8: Destructive RESET_CONTEXT requires user intent ───────────────
  if (!context.userRequestedReset) {
    const resetActions = safe.actions.filter(
      (a) => a.type === "RESET_CONTEXT" && (a as Extract<ScoutAction, { type: "RESET_CONTEXT" }>).payload.clearFilters,
    )
    if (resetActions.length > 0 && safe.answer && DESTRUCTIVE_RESET_PATTERNS.some((p) => p.test(safe.answer))) {
      // The answer explicitly suggests a destructive clear — remove the action
      safe.actions = safe.actions.filter(
        (a) => !(a.type === "RESET_CONTEXT" && (a as Extract<ScoutAction, { type: "RESET_CONTEXT" }>).payload.clearFilters),
      )
      issues.push("R8: destructive RESET_CONTEXT (clearFilters:true) removed — user intent not confirmed")
    }
  }

  // ── Rule 9: Soften fake-certainty predictive language ─────────────────────
  if (safe.answer) {
    const { softened, changed } = softtenCertaintyLanguage(safe.answer)
    if (changed) {
      safe.answer = softened
      issues.push("R9: fake-certainty language softened (e.g. 'guaranteed' → 'likely')")
    }
  }

  // ── Rule 10: Deduplicate and resolve conflicting actions ──────────────────
  const { deduped, removed: dupRemoved } = deduplicateActions(safe.actions)
  if (dupRemoved > 0) {
    safe.actions = deduped
    issues.push(`R10: ${dupRemoved} duplicate or conflicting action(s) removed`)
  }
  // Apply same dedup to workflow steps
  if (safe.workflow?.steps) {
    const stepActionsSeen = new Set<string>()
    safe.workflow.steps = safe.workflow.steps.map((step) => {
      if (!step.action) return step
      const key = actionDedupKey(step.action)
      if (stepActionsSeen.has(key)) {
        issues.push(`R10: duplicate workflow step action removed (${step.action.type})`)
        return { ...step, action: undefined }
      }
      stepActionsSeen.add(key)
      return step
    })
  }

  // ── Dev logging ───────────────────────────────────────────────────────────
  if (IS_DEV && issues.length > 0) {
    console.warn("[Scout QC]", issues.length, "issue(s) found/repaired:", issues)
  }

  return {
    valid:        issues.length === 0,
    issues,
    safeResponse: safe,
  }
}

// ── Convenience: build QCContext from existing ScoutContext data ──────────────

/**
 * Derives a QCContext from the data available in the Scout workspace shell.
 * All fields default to undefined (permissive) when data is unavailable.
 */
export function buildQCContext(opts: {
  autofillPreview?: { formFound?: boolean } | null
  jobSponsorsH1b?: boolean | null
  hasImmigrationData?: boolean
  visaLanguageDetected?: string | null
  hasMatchScore?: boolean
  userRequestedReset?: boolean
  renderContext?: QCContext["renderContext"]
}): QCContext {
  return {
    hasFormFields:        opts.autofillPreview?.formFound,
    sponsorsH1b:          opts.jobSponsorsH1b,
    hasImmigrationData:   opts.hasImmigrationData,
    visaLanguageDetected: opts.visaLanguageDetected,
    hasMatchScore:        opts.hasMatchScore,
    userRequestedReset:   opts.userRequestedReset,
    renderContext:        opts.renderContext ?? "dashboard",
  }
}
