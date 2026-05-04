export type BulkJobStatus =
  | "pending"
  | "preparing"
  | "ready"
  | "needs_review"
  | "failed"
  | "skipped"
  | "submitted"

export type BulkFailReason =
  | "missing_apply_url"
  | "unsupported_ats"
  | "missing_resume"
  | "no_sponsorship_blocker"
  | "expired_job"
  | "autofill_fields_unsupported"
  | "network_error"

export const BULK_FAIL_LABELS: Record<BulkFailReason, string> = {
  missing_apply_url:            "No apply URL found",
  unsupported_ats:              "Unsupported ATS",
  missing_resume:               "No resume attached",
  no_sponsorship_blocker:       "Job explicitly offers no sponsorship",
  expired_job:                  "Job listing may be expired",
  autofill_fields_unsupported:  "Autofill not supported for this form",
  network_error:                "Preparation failed — can retry",
}

export type BulkArtifactStatus = "pending" | "ready" | "failed" | "skipped"

export type BulkJobArtifacts = {
  resumeTailorStatus:   BulkArtifactStatus
  resumeTailorJobId?:   string
  coverLetterStatus:    BulkArtifactStatus
  coverLetterId?:       string
  autofillStatus:       BulkArtifactStatus
}

export type BulkJobWarning = {
  code:     string
  message:  string
  severity: "info" | "warning" | "error"
}

export type BulkJobItem = {
  queueId:           string
  jobId:             string
  jobTitle:          string
  company?:          string
  applyUrl?:         string
  matchScore?:       number | null
  sponsorshipSignal?: string | null
  ghostRisk?:        "low" | "medium" | "high" | null
  status:            BulkJobStatus
  failReason?:       BulkFailReason
  artifacts:         BulkJobArtifacts
  warnings:          BulkJobWarning[]
  addedAt:           string
  preparedAt?:       string
}

export type BulkApplicationQueue = {
  id:           string
  title:        string
  createdAt:    string
  completedAt?: string
  cancelledAt?: string
  jobs:         BulkJobItem[]
}

export function getQueueSummary(jobs: BulkJobItem[]) {
  return {
    total:      jobs.length,
    preparing:  jobs.filter((j) => j.status === "preparing").length,
    ready:      jobs.filter((j) => j.status === "ready").length,
    needsReview:jobs.filter((j) => j.status === "needs_review").length,
    failed:     jobs.filter((j) => j.status === "failed").length,
    skipped:    jobs.filter((j) => j.status === "skipped").length,
    submitted:  jobs.filter((j) => j.status === "submitted").length,
  }
}
