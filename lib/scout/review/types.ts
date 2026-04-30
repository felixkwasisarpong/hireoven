/**
 * Scout Review & Submit Handoff — shared types.
 *
 * Used by both the dashboard review drawer and the Chrome extension
 * final review panel. No UI or API dependencies — pure data shapes.
 */

export type SubmitReadiness = "ready" | "needs_review" | "blocked"

export type ApplicationReviewChecklist = {
  jobId:                   string
  queueItemId?:            string
  /** applicationId in job_applications table, if the job is tracked */
  applicationId?:          string

  // Artifact readiness
  resumeReady:             boolean
  coverLetterReady:        boolean
  autofillReady:           boolean

  // Human review gates
  sensitiveFieldsReviewed: boolean
  requiredFieldsComplete:  boolean

  // Feedback
  warnings:                string[]
  blockers:                string[]

  submitReadiness:         SubmitReadiness
}

export type ReviewAuditEvent =
  | "review_opened"
  | "review_closed"
  | "submitted_manually"
  | "skipped"

export type ReviewAuditEntry = {
  id:            string
  event:         ReviewAuditEvent
  jobId:         string
  queueItemId?:  string
  readiness:     SubmitReadiness
  blockerCount:  number
  warningCount:  number
  timestamp:     number
}
