/**
 * Hireoven Scout MVP — extension API client.
 *
 * Routes content-script callers (Scout Bar) through the background service
 * worker, which is the only context with chrome.cookies access for reading
 * the ho_session JWT. The bar must NOT call fetch() directly: it has no way
 * to attach the session token from a third-party page like LinkedIn.
 *
 * Wire format with background:
 *   request:  { type: "EXT_MVP_ANALYZE_JOB" | "EXT_MVP_SAVE_JOB", job }
 *   response: { ok: true, data } | { ok: false, error: string }
 */

import type { ExtractedJob } from "./extractors/scout-extractor"
import type {
  ExtensionJobAnalysis,
  ExtensionJobCheckResult,
  ExtensionSaveResult,
} from "./api-types"

type AnalyzeRequest = { type: "EXT_MVP_ANALYZE_JOB"; job: ExtractedJob }
type SaveRequest    = { type: "EXT_MVP_SAVE_JOB"; job: ExtractedJob }
type CheckRequest   = {
  type: "EXT_MVP_CHECK_JOB"
  url: string
  canonicalUrl?: string
  applyUrl?: string
}
type ProfileRequest = { type: "EXT_MVP_GET_AUTOFILL_PROFILE" }
type ResumeRequest  = { type: "EXT_MVP_FETCH_PRIMARY_RESUME"; jobId?: string }
type CoverGenRequest    = { type: "EXT_MVP_GENERATE_COVER_LETTER"; jobId: string; resumeId?: string; ats?: string }
type CoverUpdateRequest = { type: "EXT_MVP_UPDATE_COVER_LETTER"; id: string; body?: string; was_used?: boolean }
type CoverDocxRequest   = { type: "EXT_MVP_FETCH_COVER_LETTER_DOCX"; coverLetterId?: string; jobId?: string }
type ProofRequest       = {
  type: "EXT_MVP_SAVE_APPLICATION_PROOF"
  jobId?: string
  jobUrl?: string
  applyUrl?: string
  ats?: string
  submittedAt?: string
  confirmationText?: string
  resumeVersionId?: string
  coverLetterId?: string
}
type ApiSuccess<T>  = { ok: true; data: T }
type ApiFailure     = { ok: false; error: string }
type ApiResponse<T> = ApiSuccess<T> | ApiFailure

function send<T>(
  message:
    | AnalyzeRequest
    | SaveRequest
    | CheckRequest
    | ProfileRequest
    | ResumeRequest
    | CoverGenRequest
    | CoverUpdateRequest
    | CoverDocxRequest
    | ProofRequest,
): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!chrome.runtime?.id) {
      reject(new Error("Extension context invalidated"))
      return
    }
    chrome.runtime.sendMessage(message, (response: ApiResponse<T> | undefined) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message))
        return
      }
      if (!response) {
        reject(new Error("No response from background"))
        return
      }
      if (!response.ok) {
        reject(new Error(response.error))
        return
      }
      resolve(response.data)
    })
  })
}

export function analyzeExtractedJob(job: ExtractedJob): Promise<ExtensionJobAnalysis> {
  return send<ExtensionJobAnalysis>({ type: "EXT_MVP_ANALYZE_JOB", job })
}

export function saveExtractedJob(job: ExtractedJob): Promise<ExtensionSaveResult> {
  return send<ExtensionSaveResult>({ type: "EXT_MVP_SAVE_JOB", job })
}

export function checkExtractedJob(args: {
  url: string
  canonicalUrl?: string
  applyUrl?: string
}): Promise<ExtensionJobCheckResult> {
  return send<ExtensionJobCheckResult>({
    type: "EXT_MVP_CHECK_JOB",
    url: args.url,
    canonicalUrl: args.canonicalUrl,
    applyUrl: args.applyUrl,
  })
}

/**
 * Fetch the user's saved autofill profile (safe fields only — no demographics
 * unless the user explicitly opted in). Returns null when no profile exists.
 */
export function getAutofillProfile(): Promise<{
  profile: import("./autofill/safe-fields").SafeProfile | null
  profileMissing: boolean
}> {
  return send<{
    profile: import("./autofill/safe-fields").SafeProfile | null
    profileMissing: boolean
  }>({ type: "EXT_MVP_GET_AUTOFILL_PROFILE" })
}

/**
 * Fetch a resume as base64 + filename, ready for DataTransfer injection into
 * a file input.
 *
 * When `jobId` is provided, the server prefers a per-job tailored copy
 * (`tailored_for_job_id = jobId`) when one exists, falling back to the user's
 * primary. Without `jobId`, always returns the primary.
 */
export function fetchPrimaryResume(args?: {
  jobId?: string
}): Promise<{ base64: string; filename: string }> {
  return send<{ base64: string; filename: string }>({
    type: "EXT_MVP_FETCH_PRIMARY_RESUME",
    jobId: args?.jobId,
  })
}

/**
 * Generate a cover letter for the given saved job. Returns the persisted row's
 * id (for subsequent edits / DOCX download) plus the body text for review.
 */
export function generateCoverLetter(args: {
  jobId: string
  resumeId?: string
  ats?: string
}): Promise<{
  coverLetterId: string | null
  coverLetter: string
  jobTitle: string | null
  company: string | null
  source: "ai" | "template"
  atsName?: string
}> {
  return send({
    type: "EXT_MVP_GENERATE_COVER_LETTER",
    jobId: args.jobId,
    resumeId: args.resumeId,
    ats: args.ats,
  })
}

/** Persist user edits to a previously generated cover letter. */
export function updateCoverLetter(args: {
  id: string
  body?: string
  was_used?: boolean
}): Promise<{ ok: true }> {
  return send<{ ok: true }>({
    type: "EXT_MVP_UPDATE_COVER_LETTER",
    id: args.id,
    body: args.body,
    was_used: args.was_used,
  })
}

/** Fetch the cover letter as a DOCX (base64 + filename) for DataTransfer attach. */
export function fetchCoverLetterDocx(args: {
  coverLetterId?: string
  jobId?: string
}): Promise<{ base64: string; filename: string }> {
  return send<{ base64: string; filename: string }>({
    type: "EXT_MVP_FETCH_COVER_LETTER_DOCX",
    coverLetterId: args.coverLetterId,
    jobId: args.jobId,
  })
}

/**
 * Save proof that the user manually submitted an application. The bar calls
 * this only after the user clicks the explicit "Save proof" button — never
 * automatically. The server flips the existing job_applications row to
 * status='applied' and appends a timeline entry with the captured
 * confirmation text.
 */
export function saveApplicationProof(args: {
  jobId?: string
  jobUrl?: string
  applyUrl?: string
  ats?: string
  submittedAt?: string
  confirmationText?: string
  resumeVersionId?: string
  coverLetterId?: string
}): Promise<{
  ok: true
  applicationId: string
  status: string
  appliedAt: string | null
  alreadyRecorded: boolean
}> {
  return send({
    type: "EXT_MVP_SAVE_APPLICATION_PROOF",
    jobId: args.jobId,
    jobUrl: args.jobUrl,
    applyUrl: args.applyUrl,
    ats: args.ats,
    submittedAt: args.submittedAt,
    confirmationText: args.confirmationText,
    resumeVersionId: args.resumeVersionId,
    coverLetterId: args.coverLetterId,
  })
}
