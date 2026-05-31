/**
 * Scout Workflow Engine — Stateful runtime types.
 *
 * These are RUNTIME types for live workflow execution.
 * The simpler `ScoutWorkflow` in lib/scout/types.ts is the suggestion type
 * Claude returns; these types drive the step-by-step workflow panel.
 */

export type ScoutWorkflowStepStatus =
  | "pending"
  | "running"
  | "waiting_user"
  | "completed"
  | "failed"
  | "skipped"

export type ScoutActiveWorkflowStep = {
  id: string
  title: string
  description?: string
  status: ScoutWorkflowStepStatus
  /** Logical action this step represents — for display/routing, not auto-execution */
  actionType: string
  /** When true, step pauses at waiting_user and requires explicit Continue click */
  requiresConfirmation?: boolean
  /** Optional context payload (job ID, resume ID, etc.) */
  payload?: Record<string, unknown>
}

export type ScoutActiveWorkflow = {
  id: string
  title: string
  goal: string
  steps: ScoutActiveWorkflowStep[]
  activeStepId?: string
  completedAt?: string
  cancelledAt?: string
  pausedAt?: string
}

export type ScoutWorkflowType =
  | "tailor_and_prepare"
  | "compare_and_prioritize"
  | "interview_prep"

/**
 * Extension page state broadcast — sent by content script to dashboard
 * via window.postMessage when the extension is active on a job/application page.
 */
export type WorkflowExtensionState = {
  pageMode: "job_detail" | "application_form" | "search_results" | "unknown"
  autofillReady: boolean
  fieldsDetected: boolean
  ats: string
  jobContext?: {
    jobId?: string
    title?: string | null
    company?: string | null
    url: string
  }
  timestamp: number
}
