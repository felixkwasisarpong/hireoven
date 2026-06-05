/**
 * Hireoven Apex MVP — extension API client.
 *
 * Routes content-script callers (Apex Bar) through the background service
 * worker, which is the only context with chrome.cookies access for reading
 * the ho_session JWT. The bar must NOT call fetch() directly: it has no way
 * to attach the session token from a third-party page like LinkedIn.
 *
 * Wire format with background:
 *   request:  { type: "EXT_MVP_ANALYZE_JOB" | "EXT_MVP_SAVE_JOB", job }
 *   response: { ok: true, data } | { ok: false, error: string }
 */

import type { ExtractedJob } from "./extractors/apex-extractor"
import type { LinkedInProfileData } from "./extractors/linkedin-profile"
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
type ResumeRequest  = { type: "EXT_MVP_FETCH_PRIMARY_RESUME"; jobId?: string; resumeId?: string; versionId?: string }
type CoverGenRequest    = { type: "EXT_MVP_GENERATE_COVER_LETTER"; jobId: string; resumeId?: string; ats?: string }
type CoverUpdateRequest = { type: "EXT_MVP_UPDATE_COVER_LETTER"; id: string; body?: string; was_used?: boolean }
type CoverDocxRequest   = { type: "EXT_MVP_FETCH_COVER_LETTER_DOCX"; coverLetterId?: string; jobId?: string }
type AnswerQuestionRequest = {
  type: "EXT_MVP_ANSWER_QUESTION"
  question: string
  jobTitle?: string
  company?: string
}
export type MatchQuestion = {
  /** Stable client id used to map the answer back to the field. */
  id: string
  label: string
  type: "text" | "textarea" | "yesno" | "select"
  /** Allowed choices for select/radio fields — answers are constrained to these. */
  options?: string[]
}
export type MatchedAnswer = {
  id: string
  /** yesno → "yes"/"no"; select → exact option; text → value; null = answer manually. */
  value: string | null
  confidence: "high" | "medium" | "low"
}
type MatchQuestionsRequest = {
  type: "EXT_MVP_MATCH_QUESTIONS"
  questions: MatchQuestion[]
  jobTitle?: string
  company?: string
}
type AutofillTelemetryRequest = {
  type: "EXT_MVP_TRACK_AUTOFILL"
  payload: {
    jobId?: string
    companyName?: string
    jobTitle?: string
    atsType?: string
    stage: "preview" | "attempt" | "success" | "partial" | "error"
    fieldsFilled?: number
    fieldsTotal?: number
    manualReviewCount?: number
    errorMessage?: string
    pageUrl?: string
    fallbackUsed?: boolean
  }
}
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
    | ProofRequest
    | AnswerQuestionRequest
    | MatchQuestionsRequest
    | AutofillTelemetryRequest,
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
  resumeId?: string
  versionId?: string
}): Promise<{ base64: string; filename: string }> {
  return send<{ base64: string; filename: string }>({
    type: "EXT_MVP_FETCH_PRIMARY_RESUME",
    jobId: args?.jobId,
    resumeId: args?.resumeId,
    versionId: args?.versionId,
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

/**
 * Use the user's resume to generate an answer to an open-ended application
 * question. Returns the generated answer string, or throws on failure.
 */
export function answerQuestion(args: {
  question: string
  jobTitle?: string
  company?: string
}): Promise<{ answer: string }> {
  return send<{ answer: string }>({
    type: "EXT_MVP_ANSWER_QUESTION",
    question: args.question,
    jobTitle: args.jobTitle,
    company: args.company,
  })
}

/**
 * Semantic "second tier" for the apply agent: batch the required fields the
 * fast matcher couldn't answer and resolve them in one server-side Claude call
 * against the user's profile/résumé. `select` answers are constrained to the
 * options passed in. A `null` value means "leave for manual review".
 */
export function matchQuestions(args: {
  questions: MatchQuestion[]
  jobTitle?: string
  company?: string
}): Promise<{ answers: MatchedAnswer[] }> {
  return send<{ answers: MatchedAnswer[] }>({
    type: "EXT_MVP_MATCH_QUESTIONS",
    questions: args.questions,
    jobTitle: args.jobTitle,
    company: args.company,
  })
}

/**
 * Best-effort autofill run telemetry for extension E2E reliability metrics.
 */
export function trackAutofillTelemetry(payload: {
  jobId?: string
  companyName?: string
  jobTitle?: string
  atsType?: string
  stage: "preview" | "attempt" | "success" | "partial" | "error"
  fieldsFilled?: number
  fieldsTotal?: number
  manualReviewCount?: number
  errorMessage?: string
  pageUrl?: string
  fallbackUsed?: boolean
}): Promise<{ ok: true }> {
  return send<{ ok: true }>({
    type: "EXT_MVP_TRACK_AUTOFILL",
    payload,
  })
}

/**
 * Silently sync scraped LinkedIn profile data to Hireoven.
 * Fire-and-forget — no response handling needed.
 * Only called when isOwnLinkedInProfile() returns true.
 */
export function syncLinkedInBrandProfile(profile: LinkedInProfileData): void {
  if (!chrome.runtime?.id) return
  chrome.runtime.sendMessage({
    type: "SYNC_LINKEDIN_BRAND_PROFILE",
    profile: {
      linkedinUrl:             profile.linkedinUrl,
      headline:                profile.headline,
      hasAboutSection:         profile.hasAboutSection,
      skillsCount:             profile.skillsCount,
      recommendationsCount:    profile.recommendationsCount,
      connectionsEstimate:     profile.connectionsEstimate,
      lastPostDetectedAt:      profile.lastPostDetectedAt,
      daysSinceLastActivity:   profile.daysSinceLastActivity,
    },
  }, () => {
    // Intentionally ignore response — fire and forget
    void chrome.runtime.lastError
  })
}
