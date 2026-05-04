/**
 * Submit readiness computation — pure logic, no I/O.
 *
 * Derives an ApplicationReviewChecklist from artifact statuses and
 * optional autofill intelligence data. Runs on both dashboard and extension.
 */

import type { ApplicationReviewChecklist, SubmitReadiness } from "./types"
import type { BulkJobArtifacts, BulkJobWarning } from "@/lib/scout/bulk-application/types"

type AutofillCounts = {
  sensitive:   number
  unsupported: number
  missing:     number
  review:      number
  ready:       number
}

type ReadinessInput = {
  jobId:          string
  queueItemId?:   string
  applicationId?: string
  artifacts:      BulkJobArtifacts
  autofillCounts?: AutofillCounts
  /** Extra job-level blockers (e.g. "no sponsorship", "expired") */
  extraBlockers?: string[]
  /** Extra warnings from preparation step */
  preparationWarnings?: BulkJobWarning[]
  /** Whether the user has explicitly acknowledged sensitive fields */
  sensitiveAcknowledged?: boolean
}

export function computeReadiness(input: ReadinessInput): ApplicationReviewChecklist {
  const {
    jobId,
    queueItemId,
    applicationId,
    artifacts,
    autofillCounts,
    extraBlockers = [],
    preparationWarnings = [],
    sensitiveAcknowledged = false,
  } = input

  const blockers: string[] = [...extraBlockers]
  const warnings: string[] = []

  // ── Resume ───────────────────────────────────────────────────────────────────
  const resumeReady = artifacts.resumeTailorStatus === "ready"
  if (artifacts.resumeTailorStatus === "failed") {
    warnings.push("Resume tailor analysis failed — apply with your base resume or tailor manually.")
  }

  // ── Cover letter ─────────────────────────────────────────────────────────────
  const coverLetterReady = artifacts.coverLetterStatus === "ready"
  if (artifacts.coverLetterStatus === "failed") {
    warnings.push("Cover letter draft failed — generate one manually before applying.")
  }

  // ── Autofill ─────────────────────────────────────────────────────────────────
  const autofillReady = artifacts.autofillStatus === "ready"
  if (!autofillReady) {
    blockers.push("No autofill profile — complete your profile before applying.")
  }

  // ── Autofill field analysis ───────────────────────────────────────────────────
  let sensitiveFieldsReviewed = sensitiveAcknowledged
  let requiredFieldsComplete   = true

  if (autofillCounts) {
    if (autofillCounts.unsupported > 0) {
      blockers.push(
        `${autofillCounts.unsupported} field${autofillCounts.unsupported !== 1 ? "s" : ""} require manual input (file upload or unsupported type).`
      )
      requiredFieldsComplete = false
    }
    if (autofillCounts.sensitive > 0 && !sensitiveAcknowledged) {
      warnings.push(
        `${autofillCounts.sensitive} sensitive question${autofillCounts.sensitive !== 1 ? "s" : ""} (sponsorship/legal/EEO) must be answered manually.`
      )
      sensitiveFieldsReviewed = false
    } else if (autofillCounts.sensitive > 0) {
      sensitiveFieldsReviewed = true
    }
    if (autofillCounts.missing > 0) {
      warnings.push(
        `${autofillCounts.missing} field${autofillCounts.missing !== 1 ? "s" : ""} could not be filled — check your autofill profile.`
      )
    }
    if (autofillCounts.review > 0) {
      warnings.push(
        `${autofillCounts.review} field${autofillCounts.review !== 1 ? "s" : ""} need manual review (low-confidence suggestions).`
      )
    }
  }

  // ── Preparation warnings ──────────────────────────────────────────────────────
  for (const w of preparationWarnings) {
    if (w.severity === "error") {
      blockers.push(w.message)
    } else if (w.severity === "warning") {
      warnings.push(w.message)
    }
  }

  // ── Readiness determination ───────────────────────────────────────────────────
  let submitReadiness: SubmitReadiness
  if (blockers.length > 0) {
    submitReadiness = "blocked"
  } else if (
    warnings.length > 0 ||
    !resumeReady ||
    !coverLetterReady ||
    !sensitiveFieldsReviewed
  ) {
    submitReadiness = "needs_review"
  } else {
    submitReadiness = "ready"
  }

  return {
    jobId,
    queueItemId,
    applicationId,
    resumeReady,
    coverLetterReady,
    autofillReady,
    sensitiveFieldsReviewed,
    requiredFieldsComplete,
    warnings,
    blockers,
    submitReadiness,
  }
}
