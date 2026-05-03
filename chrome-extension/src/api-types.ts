/**
 * Shared API contract for the Hireoven Scout MVP.
 *
 * Mirrored intentionally on the server side (in app/api/extension/jobs/*).
 * Keep the two in sync when changing fields. Both are intentionally minimal.
 */

export type ExtensionJobAnalysisSignalType =
  | "matched_skill"
  | "missing_skill"
  | "salary"
  | "work_mode"
  | "location"
  | "sponsorship"
  | "ghost_risk"
  | "requirement"

export type ExtensionJobAnalysisSignal = {
  label: string
  type: ExtensionJobAnalysisSignalType
  evidence?: string
  confidence: "high" | "medium" | "low"
}

export type ExtensionSponsorshipStatus =
  | "likely"
  | "no_sponsorship"
  | "unclear"
  | "unknown"

export type ExtensionGhostRiskLevel = "low" | "medium" | "high" | "unknown"

export type ExtensionJobAnalysis = {
  jobId?: string
  existsInHireoven: boolean
  matchScore?: number
  autofillSupported: boolean
  detectedAts?: string
  ghostRisk?: {
    level: ExtensionGhostRiskLevel
    reasons: string[]
  }
  sponsorship?: {
    status: ExtensionSponsorshipStatus
    evidence: string[]
  }
  signals: ExtensionJobAnalysisSignal[]
  actions: {
    canSave: boolean
    canAnalyze: boolean
    canTailorResume: boolean
    canAutofill: boolean
  }
}

export type ExtensionSaveResult = {
  jobId: string
  created: boolean
  updated: boolean
  dashboardUrl?: string
}

/**
 * Lightweight presence check returned by GET /api/extension/jobs/check.
 * Bar uses this on every job-page mount to gate the Save button.
 */
export type ExtensionJobCheckResult = {
  saved: boolean
  jobId?: string
  applicationId?: string
  dashboardUrl?: string
}
