/**
 * Scout Actions - Validation & Normalization
 * Phase 1.3: Safe UI Actions
 */

import type { ScoutAction, ScoutActionType } from "./types"

const ALLOWED_ACTION_TYPES: ScoutActionType[] = [
  "OPEN_JOB",
  "APPLY_FILTERS",
  "OPEN_RESUME_TAILOR",
  "HIGHLIGHT_JOBS",
  "OPEN_COMPANY",
  "SET_FOCUS_MODE",
  "RESET_CONTEXT",
  // Phase 1.4 placeholder — not validated by Claude yet, only surfaced manually.
  "OPEN_EXTENSION_BRIDGE",
  // Phase 2 — autofill preview hint from Scout.
  "OPEN_EXTENSION_AUTOFILL_PREVIEW",
]

const MAX_ACTIONS_PER_RESPONSE = 4

/**
 * Validates whether an action is allowed and well-formed.
 */
export function isAllowedScoutAction(action: unknown): action is ScoutAction {
  if (typeof action !== "object" || action === null) return false
  
  const candidate = action as Record<string, unknown>
  
  // Must have a type
  if (typeof candidate.type !== "string") return false
  if (!ALLOWED_ACTION_TYPES.includes(candidate.type as ScoutActionType)) return false
  
  // Must have a payload
  if (typeof candidate.payload !== "object" || candidate.payload === null) return false
  
  const payload = candidate.payload as Record<string, unknown>
  
  // Type-specific validation
  switch (candidate.type) {
    case "OPEN_JOB":
      return typeof payload.jobId === "string" && payload.jobId.length > 0
    
    case "APPLY_FILTERS":
      // At least one filter must be specified
      return (
        (typeof payload.query === "string" && payload.query.length > 0) ||
        (typeof payload.location === "string" && payload.location.length > 0) ||
        (typeof payload.workMode === "string" && payload.workMode.length > 0) ||
        (typeof payload.sponsorship === "string" && ["high", "moderate", "low"].includes(payload.sponsorship))
      )
    
    case "OPEN_RESUME_TAILOR":
      // At least jobId or resumeId should be provided
      return (
        (typeof payload.jobId === "string" && payload.jobId.length > 0) ||
        (typeof payload.resumeId === "string" && payload.resumeId.length > 0)
      )
    
    case "HIGHLIGHT_JOBS":
      return (
        Array.isArray(payload.jobIds) &&
        payload.jobIds.length > 0 &&
        payload.jobIds.every((id) => typeof id === "string" && id.length > 0)
      )
    
    case "OPEN_COMPANY":
      return typeof payload.companyId === "string" && payload.companyId.length > 0

    case "SET_FOCUS_MODE":
      return typeof payload.enabled === "boolean"

    case "RESET_CONTEXT":
      // Always valid — payload is entirely optional
      return true

    case "OPEN_EXTENSION_BRIDGE":
      // Always valid — hint is optional
      return true

    case "OPEN_EXTENSION_AUTOFILL_PREVIEW":
      // Always valid — hint and url are optional
      return true

    default:
      return false
  }
}

/**
 * Normalizes and validates an array of actions from Claude.
 * Returns only valid actions, capped at MAX_ACTIONS_PER_RESPONSE.
 */
export function normalizeScoutActions(actions: unknown): ScoutAction[] {
  if (!Array.isArray(actions)) return []
  
  const validActions: ScoutAction[] = []
  
  for (const action of actions) {
    if (validActions.length >= MAX_ACTIONS_PER_RESPONSE) break
    
    if (isAllowedScoutAction(action)) {
      validActions.push(action)
    }
  }
  
  return validActions
}

/**
 * Generates a default label for an action if none is provided.
 */
export function getDefaultActionLabel(action: ScoutAction): string {
  switch (action.type) {
    case "OPEN_JOB":
      return "View Job"
    case "APPLY_FILTERS":
      return "Apply Filters"
    case "OPEN_RESUME_TAILOR":
      return "Tailor Resume"
    case "HIGHLIGHT_JOBS":
      return `Highlight ${action.payload.jobIds.length} Jobs`
    case "OPEN_COMPANY":
      return "View Company"
    case "SET_FOCUS_MODE":
      return action.payload.enabled ? "Turn on Focus Mode" : "Turn off Focus Mode"
    case "RESET_CONTEXT":
      return "Reset Scout context"
    case "OPEN_EXTENSION_BRIDGE":
      return "Open Scout Extension"
    case "OPEN_EXTENSION_AUTOFILL_PREVIEW":
      return "Autofill this Application"
    default:
      return "Execute Action"
  }
}
