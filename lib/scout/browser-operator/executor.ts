/**
 * Browser Operator Executor — client-safe, no server calls.
 *
 * Dispatches approved browser actions to the extension via the
 * existing window.postMessage bridge. Each action maps to a
 * ScoutExtensionCommand that the extension content script handles.
 *
 * Fire-and-forget: the bridge has no return channel for most actions,
 * so the caller uses optimistic completion after dispatch.
 *
 * Safety: hard-blocked actions are rejected before reaching this layer.
 * The permission check is done in useScoutBrowserOperator before calling here.
 */

import { FROM_SCOUT } from "@/lib/scout/browser-context"
import type { ScoutBrowserAction } from "./types"

// ── Action → extension command mapping ───────────────────────────────────────

const ACTION_TO_COMMAND: Record<ScoutBrowserAction, string> = {
  prepare_autofill:  "OPEN_AUTOFILL",
  open_drawer:       "OPEN_AUTOFILL",
  open_tab:          "OPERATOR_OPEN_TAB",
  navigate:          "OPERATOR_NAVIGATE",
  focus_field:       "OPERATOR_FOCUS_FIELD",
  scroll_to:         "OPERATOR_SCROLL_TO",
  highlight_element: "OPERATOR_HIGHLIGHT_FIELD",
  insert_text:       "OPERATOR_INSERT_TEXT",
  upload_resume:     "OPERATOR_UPLOAD_RESUME",
}

// Actions the extension can handle in V1 (others are dispatched but may no-op)
const EXTENSION_SUPPORTED_V1 = new Set<ScoutBrowserAction>([
  "prepare_autofill",
  "open_drawer",
  "highlight_element",
  "focus_field",
  "scroll_to",
  "upload_resume",
  "insert_text",
  "open_tab",
  "navigate",
])

export type ExecuteResult = {
  dispatched: boolean
  reason?:    string   // why not dispatched (no extension, unsupported, etc.)
}

/**
 * Dispatch one approved browser action to the extension.
 * Returns immediately — completion is optimistic.
 */
export function dispatchBrowserAction(
  action:   ScoutBrowserAction,
  payload?: Record<string, unknown>,
): ExecuteResult {
  if (typeof window === "undefined") {
    return { dispatched: false, reason: "Not in browser context" }
  }

  if (!EXTENSION_SUPPORTED_V1.has(action)) {
    return { dispatched: false, reason: `Action "${action}" not yet supported in V1` }
  }

  const command = ACTION_TO_COMMAND[action]

  try {
    window.postMessage(
      { source: FROM_SCOUT, type: command, ...(payload ?? {}) },
      window.location.origin,
    )
    return { dispatched: true }
  } catch {
    return { dispatched: false, reason: "Extension bridge unavailable" }
  }
}

/** Generate a readable summary sentence for a browser action event. */
export function buildActionSummary(
  action:  ScoutBrowserAction,
  target?: string,
  context?: { company?: string; atsProvider?: string }
): string {
  const where = context?.company
    ? ` on ${context.company}`
    : context?.atsProvider
    ? ` on ${context.atsProvider}`
    : ""

  switch (action) {
    case "prepare_autofill":
    case "open_drawer":
      return `Scout opened the autofill drawer${where}.`
    case "upload_resume":
      return target
        ? `Scout prepared to attach "${target}"${where}.`
        : `Scout prepared resume upload${where}.`
    case "insert_text":
      return target
        ? `Scout inserted text into "${target}"${where}.`
        : `Scout inserted text into the form${where}.`
    case "focus_field":
      return target
        ? `Scout focused the "${target}" field.`
        : "Scout focused a form field."
    case "highlight_element":
      return target
        ? `Scout highlighted the "${target}" section.`
        : "Scout highlighted a form section."
    case "scroll_to":
      return target
        ? `Scout scrolled to "${target}".`
        : "Scout scrolled to the section."
    case "navigate":
      return target ? `Scout navigated to ${target}.` : "Scout navigated the application tab."
    case "open_tab":
      return target ? `Scout opened ${target} in a new tab.` : "Scout opened the application page."
    default:
      return "Scout performed a browser action."
  }
}

/** Generate the pending-approval message shown before user approves. */
export function buildApprovalPrompt(
  action:  ScoutBrowserAction,
  target?: string,
): string {
  switch (action) {
    case "upload_resume":
      return target
        ? `Scout wants to attach your resume "${target}" to this application.`
        : "Scout wants to attach your resume to this application."
    case "insert_text":
      return target
        ? `Scout wants to insert text into the "${target}" field.`
        : "Scout wants to insert text into the application form."
    case "navigate":
      return target
        ? `Scout wants to navigate to ${target}.`
        : "Scout wants to navigate the active tab."
    default:
      return "Scout is requesting your approval before continuing."
  }
}
