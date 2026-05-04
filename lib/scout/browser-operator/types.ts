/**
 * Scout Browser Operator — Types V1
 *
 * Supervised browser operation: every action is visible, reviewable,
 * and cancellable. The operator never submits, never hides actions,
 * never manipulates hidden fields.
 *
 * Safety contract:
 *   HARD NEVER: submit_application, bypass_ats, silent_upload, hidden_fill
 *   Every sensitive action: requires explicit user approval before dispatch
 *   Every action: recorded in the timeline
 *   User can cancel any queued action at any time
 */

// ── Action types ──────────────────────────────────────────────────────────────

export type ScoutBrowserAction =
  | "open_tab"           // open job/application page in a new tab
  | "navigate"           // navigate the active job tab to a URL
  | "focus_field"        // focus a specific form field (visual hint only)
  | "scroll_to"          // scroll to a section / field
  | "highlight_element"  // briefly highlight a field or section
  | "prepare_autofill"   // open the autofill review drawer
  | "insert_text"        // insert cover letter / text into a field (requires approval)
  | "upload_resume"      // attach a resume file to the form (requires approval)
  | "open_drawer"        // open the Scout extension overlay drawer

// ── Action event ──────────────────────────────────────────────────────────────

export type ScoutBrowserActionStatus =
  | "pending"    // waiting for user approval
  | "running"    // dispatched to extension, awaiting completion
  | "completed"  // extension confirmed or optimistic completion
  | "failed"     // dispatch failed or extension reported error
  | "blocked"    // permission denied or extension not connected

export type ScoutBrowserActionEvent = {
  id:              string
  action:          ScoutBrowserAction
  status:          ScoutBrowserActionStatus
  /** Human-readable target (e.g. "Work Authorization field", "Resume.pdf") */
  target?:         string
  /** One-sentence status description shown in the action strip */
  summary?:        string
  /** True when this action must pause for explicit user approval */
  requiresApproval?: boolean
  timestamp:       string
  /** Optional: job/form context for timeline display */
  context?: {
    jobTitle?:   string
    company?:    string
    atsProvider?: string
  }
}

// ── Permission mapping ────────────────────────────────────────────────────────
// Maps operator actions to existing ScoutPermission keys.
// No new permissions needed — all actions map to existing system permissions.

export const BROWSER_ACTION_PERMISSION: Partial<Record<ScoutBrowserAction, string>> = {
  prepare_autofill:  "autofill_fields",
  open_drawer:       "autofill_fields",
  insert_text:       "insert_cover_letter",
  upload_resume:     "attach_resume",
  navigate:          "open_external_pages",
  open_tab:          "open_external_pages",
  // focus_field, scroll_to, highlight_element: informational — no permission gate
}

// ── Approval gates ────────────────────────────────────────────────────────────
// Actions that MUST pause for explicit user approval before dispatching.

export const APPROVAL_REQUIRED_ACTIONS = new Set<ScoutBrowserAction>([
  "upload_resume",
  "insert_text",
  "navigate",
])

// ── Human-readable action labels ──────────────────────────────────────────────

export const BROWSER_ACTION_LABELS: Record<ScoutBrowserAction, string> = {
  open_tab:          "Open application tab",
  navigate:          "Navigate to page",
  focus_field:       "Focus field",
  scroll_to:         "Scroll to section",
  highlight_element: "Highlight element",
  prepare_autofill:  "Prepare autofill",
  insert_text:       "Insert text",
  upload_resume:     "Upload resume",
  open_drawer:       "Open Scout drawer",
}
