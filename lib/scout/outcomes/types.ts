/**
 * Scout Outcome Tracking + Learning Loop — Types V1
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
