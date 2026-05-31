/**
 * Browser Operator Executor — client-safe, no server calls.
 *
 * Dispatches approved browser actions to the extension via the
 * existing window.postMessage bridge. Each action maps to a
 * ApexExtensionCommand that the extension content script handles.
 *
 * Fire-and-forget: the bridge has no return channel for most actions,
 * so the caller uses optimistic completion after dispatch.
 *
 * Safety: hard-blocked actions are rejected before reaching this layer.
 * The permission check is done in useApexBrowserOperator before calling here.
 */

import { FROM_APEX } from "@/lib/apex/browser-context"
import type { ApexBrowserAction } from "./types"

// ── Action → extension command mapping ───────────────────────────────────────

const ACTION_TO_COMMAND: Record<ApexBrowserAction, string> = {
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
const EXTENSION_SUPPORTED_V1 = new Set<ApexBrowserAction>([
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
  action:   ApexBrowserAction,
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
      { source: FROM_APEX, type: command, ...(payload ?? {}) },
      window.location.origin,
    )
    return { dispatched: true }
  } catch {
    return { dispatched: false, reason: "Extension bridge unavailable" }
  }
}

/**
 * Ping the extension and return true if it responds within 2 s.
 * Sends EXTENSION_PING via the same postMessage bridge; the extension
 * content script must reply with { type: "EXTENSION_PONG" }.
 */
export async function pingExtension(): Promise<boolean> {
  if (typeof window === "undefined") return false

  return new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => {
      window.removeEventListener("message", handler)
      resolve(false)
    }, 2000)

    function handler(event: MessageEvent) {
      if (
        event.data?.type === "EXTENSION_PONG" ||
        event.data?.source === "hireoven-extension"
      ) {
        clearTimeout(timeout)
        window.removeEventListener("message", handler)
        resolve(true)
      }
    }

    window.addEventListener("message", handler)
    try {
      window.postMessage(
        { source: FROM_APEX, type: "EXTENSION_PING" },
        window.location.origin,
      )
    } catch {
      clearTimeout(timeout)
      window.removeEventListener("message", handler)
      resolve(false)
    }
  })
}

/** Generate a readable summary sentence for a browser action event. */
export function buildActionSummary(
  action:  ApexBrowserAction,
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
      return `Apex opened the autofill drawer${where}.`
    case "upload_resume":
      return target
        ? `Apex prepared to attach "${target}"${where}.`
        : `Apex prepared resume upload${where}.`
    case "insert_text":
      return target
        ? `Apex inserted text into "${target}"${where}.`
        : `Apex inserted text into the form${where}.`
    case "focus_field":
      return target
        ? `Apex focused the "${target}" field.`
        : "Apex focused a form field."
    case "highlight_element":
      return target
        ? `Apex highlighted the "${target}" section.`
        : "Apex highlighted a form section."
    case "scroll_to":
      return target
        ? `Apex scrolled to "${target}".`
        : "Apex scrolled to the section."
    case "navigate":
      return target ? `Apex navigated to ${target}.` : "Apex navigated the application tab."
    case "open_tab":
      return target ? `Apex opened ${target} in a new tab.` : "Apex opened the application page."
    default:
      return "Apex performed a browser action."
  }
}

/** Generate the pending-approval message shown before user approves. */
export function buildApprovalPrompt(
  action:  ApexBrowserAction,
  target?: string,
): string {
  switch (action) {
    case "upload_resume":
      return target
        ? `Apex wants to attach your resume "${target}" to this application.`
        : "Apex wants to attach your resume to this application."
    case "insert_text":
      return target
        ? `Apex wants to insert text into the "${target}" field.`
        : "Apex wants to insert text into the application form."
    case "navigate":
      return target
        ? `Apex wants to navigate to ${target}.`
        : "Apex wants to navigate the active tab."
    default:
      return "Apex is requesting your approval before continuing."
  }
}
