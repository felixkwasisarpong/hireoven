/**
 * Scout Browser Action Timeline — Types V1
 *
 * Transparent, append-only log of Scout activity, workspace transitions,
 * extension events, and workflow steps within the current session.
 *
 * Privacy contract:
 *   NEVER store: form field values, resume text, cover letter content,
 *                application answers, raw page HTML, sensitive legal answers
 *   ALWAYS store: event type, human-readable title, safe metadata (IDs, counts)
 *
 * Replay contract:
 *   Replay is UI/session restoration — not re-execution of actions.
 *   It pre-fills command bars, scrolls to panels, or restores workspace state.
 *   It never autonomously submits or re-runs network calls.
 */

export type ScoutTimelineEventType =
  | "command"                  // user submitted a Scout message
  | "workspace_change"         // workspace mode switched
  | "workflow_started"         // a new workflow was launched
  | "workflow_step"            // workflow progressed to a new step
  | "extension_detected_page"  // extension reported a new page context
  | "job_resolved"             // active browser tab resolved a job ID
  | "autofill_detected"        // extension reported autofill availability
  | "autofill_reviewed"        // user opened the autofill review panel
  | "permission_prompt"        // a Scout permission gate was triggered
  | "research_started"         // autonomous research task began
  | "research_finding"         // research finding emitted
  | "manual_submit"            // user marked an application as submitted
  | "browser_action"           // Scout browser operator dispatched an action
  | "error"                    // any Scout or extension error

export type TimelineFilter =
  | "all"
  | "workflows"
  | "autofill"
  | "research"
  | "applications"
  | "extension"
  | "errors"

export type ScoutTimelineReplayAction = {
  type:
    | "resend_command"      // pre-fill the command bar with the original message
    | "reopen_workflow"     // restore workflow panel + applications workspace
    | "reopen_compare"      // restore compare workspace
    | "reopen_research"     // restore research mode from local cache
    | "restore_workspace"   // switch workspace to the saved mode
    | "restore_job_context" // restore active job/company context in workspace shell
  payload?: Record<string, unknown>
}

export type ScoutTimelineEvent = {
  id:        string
  type:      ScoutTimelineEventType
  title:     string
  summary?:  string
  timestamp: string
  severity?: "info" | "warning" | "error"
  /** When true the user can click ↩ to replay the action. */
  replayable?:   boolean
  replayAction?: ScoutTimelineReplayAction
  /**
   * Extended metadata — populated in all environments.
   * Exposed in the UI only when NODE_ENV === "development".
   * Must never contain sensitive values (form answers, resume text, etc).
   */
  metadata?: Record<string, unknown>
}

// ── Filter → event type mapping ───────────────────────────────────────────────

export const FILTER_EVENT_TYPES: Record<TimelineFilter, ScoutTimelineEventType[]> = {
  all:       [],
  workflows: ["workflow_started", "workflow_step"],
  autofill:  ["autofill_detected", "autofill_reviewed", "permission_prompt", "browser_action"],
  research:  ["research_started", "research_finding"],
  applications: ["manual_submit", "job_resolved", "workflow_step", "workflow_started"],
  extension: ["extension_detected_page", "job_resolved"],
  errors:    ["error"],
}
