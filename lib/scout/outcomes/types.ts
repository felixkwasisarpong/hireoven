/**
 * Scout Outcome Tracking + Learning Loop — Types V2
 *
 * Outcomes are user-controlled signals about what happened after applying.
 * Learning signals are derived from patterns in recorded outcomes.
 *
 * Safety rules:
 *   - No inferences about protected traits
 *   - No shame-based language
 *   - No fake causality ("doing X caused Y")
 *   - Cautious language: "appears to work better", "based on recorded outcomes"
 */

import type { RoleCategory, JobSector } from "./categorizers"

// ── V2: Typed outcome lifecycle ────────────────────────────────────────────────

export type ScoutOutcomeType =
  | "application_sent"
  | "application_reviewed"   // employer opened the application
  | "recruiter_reply"         // recruiter reached out
  | "interview_received"      // first interview scheduled
  | "interview_passed"        // advanced past at least one round
  | "offer_received"          // offer extended
  | "offer_accepted"          // user accepted
  | "application_rejected"    // formal rejection
  | "workflow_abandoned"      // user abandoned a Scout workflow mid-way

export type ScoutOutcomeMeta = {
  roleCategory?:      RoleCategory | null
  sector?:            JobSector | null
  sponsorshipRelated?: boolean
  workMode?:          "remote" | "hybrid" | "onsite" | null
}

/** V2 outcome event — persisted to scout_outcomes table */
export type ScoutOutcome = {
  id:               string
  type:             ScoutOutcomeType
  relatedJobId?:    string | null
  relatedCompanyId?: string | null
  applicationId?:   string | null
  metadata?:        ScoutOutcomeMeta
  source:           "manual" | "application_status" | "extension" | "workflow"
  createdAt:        string
}

/** Reaction a user records against a learning signal */
export type ScoutSignalReaction =
  | "helpful"
  | "not_helpful"
  | "got_interview"
  | "applied"
  | "rejected"
  | "ignore"

export const SIGNAL_REACTION_LABELS: Record<ScoutSignalReaction, string> = {
  helpful:       "Helpful",
  not_helpful:   "Not helpful",
  got_interview: "Got interview",
  applied:       "Applied",
  rejected:      "Rejected",
  ignore:        "Ignore",
}

// Maps V2 ScoutOutcomeType → V1 ApplicationOutcome (for backward compat with existing DB logic)
export const OUTCOME_TYPE_TO_APP_OUTCOME: Record<ScoutOutcomeType, string> = {
  application_sent:      "applied",
  application_reviewed:  "applied",
  recruiter_reply:       "recruiter_screen",
  interview_received:    "interview",
  interview_passed:      "interview",
  offer_received:        "offer",
  offer_accepted:        "offer",
  application_rejected:  "rejected",
  workflow_abandoned:    "withdrawn",
}

// Human-readable labels for each outcome type
export const SCOUT_OUTCOME_LABELS: Record<ScoutOutcomeType, string> = {
  application_sent:      "Application sent",
  application_reviewed:  "Application reviewed by employer",
  recruiter_reply:       "Recruiter replied",
  interview_received:    "Interview received",
  interview_passed:      "Interview passed (advanced)",
  offer_received:        "Offer received",
  offer_accepted:        "Offer accepted",
  application_rejected:  "Application rejected",
  workflow_abandoned:    "Workflow abandoned",
}

// Positive outcomes for learning signal purposes
export const POSITIVE_SCOUT_OUTCOMES = new Set<ScoutOutcomeType>([
  "recruiter_reply",
  "interview_received",
  "interview_passed",
  "offer_received",
  "offer_accepted",
])

// ── Outcome types ─────────────────────────────────────────────────────────────

export type ApplicationOutcome =
  | "applied"
  | "viewed_by_employer"
  | "recruiter_screen"
  | "interview"
  | "assessment"
  | "offer"
  | "rejected"
  | "ghosted"
  | "withdrawn"

/** Maps ApplicationOutcome to the closest existing ApplicationStatus in the DB */
export const OUTCOME_TO_STATUS: Record<ApplicationOutcome, string> = {
  applied:            "applied",
  viewed_by_employer: "applied",
  recruiter_screen:   "phone_screen",
  interview:          "interview",
  assessment:         "interview",
  offer:              "offer",
  rejected:           "rejected",
  ghosted:            "applied",     // kept as applied, ghosted flag tracked separately
  withdrawn:          "withdrawn",
}

export const OUTCOME_LABELS: Record<ApplicationOutcome, string> = {
  applied:            "Applied",
  viewed_by_employer: "Viewed by employer",
  recruiter_screen:   "Recruiter screen",
  interview:          "Interview",
  assessment:         "Assessment / take-home",
  offer:              "Offer received",
  rejected:           "Rejected",
  ghosted:            "No response (ghosted)",
  withdrawn:          "Withdrawn",
}

export const POSITIVE_OUTCOMES = new Set<ApplicationOutcome>(["recruiter_screen", "interview", "assessment", "offer"])
export const TERMINAL_OUTCOMES = new Set<ApplicationOutcome>(["offer", "rejected", "ghosted", "withdrawn"])

// ── Outcome signal ────────────────────────────────────────────────────────────

export type ScoutOutcomeSignal = {
  applicationId: string
  jobId:         string
  companyId?:    string
  outcome:       ApplicationOutcome
  occurredAt:    string
  source:
    | "manual"
    | "email_detected"
    | "calendar_detected"
    | "application_status"
  confidence:  number
  evidence?:   string[]
}

// ── Learning signals ──────────────────────────────────────────────────────────

export type OutcomeLearningSignal = {
  id:              string
  signal:          string
  evidence:        string[]
  confidence:      "high" | "medium" | "low"
  /** Optional suggested Scout action or mission adjustment */
  suggestedAction?: string
  /** What dimension drove this signal (role, company type, work mode, etc.) */
  dimension:       "role_type" | "work_mode" | "company_type" | "sponsorship" | "seniority" | "general"
}

// ── Feedback item — stale applications needing a status update ────────────────

export type ApplicationFeedbackItem = {
  applicationId: string
  jobTitle:      string
  companyName:   string
  appliedAt:     string
  daysSinceApplied: number
  currentStatus: string
}

// ── Learning result ───────────────────────────────────────────────────────────

export type OutcomeLearningResult = {
  signals:          OutcomeLearningSignal[]
  feedbackNeeded:   ApplicationFeedbackItem[]
  stats: {
    totalApplications:   number
    responded:           number
    responseRate:        number
    interviewRate:       number
    offerRate:           number
  }
  generatedAt: string
}
