// ── ATS / Page detection ──────────────────────────────────────────────────────

export type ATSProvider =
  | "workday"
  | "greenhouse"
  | "lever"
  | "ashby"
  | "icims"
  | "smartrecruiters"
  | "bamboohr"
  | "generic"

export type PageType = "job_listing" | "application_form" | "unknown"

export type ExtensionPageMode =
  | "job_detail"
  | "application_form"
  | "search_results"
  | "unknown"

export type ExtensionCommand =
  | "RESOLVE_JOB"
  | "SAVE_JOB"
  | "CHECK_MATCH"
  | "TAILOR_RESUME"
  | "GENERATE_COVER_LETTER"
  | "OPEN_AUTOFILL_DRAWER"
  | "FILL_SAFE_FIELDS"
  | "OPEN_PROFILE_MENU"
  | "OPEN_HIREOVEN"

export interface DetectedPage {
  pageType: PageType
  ats: ATSProvider
  url: string
  title: string | null
}

// ── Extracted job data ────────────────────────────────────────────────────────

export interface ExtractedJob {
  title: string | null
  company: string | null
  companyLogo: string | null
  companyVerified?: boolean | null
  location: string | null
  workMode?: string | null
  employmentType?: string | null
  postedAt?: string | null
  description: string | null
  salary: string | null
  salaryRange?: string | null
  easyApply?: boolean | null
  activelyHiring?: boolean | null
  topApplicantSignal?: boolean | null
  companySummary?: string | null
  companyFoundedYear?: number | null
  companyEmployeeCount?: string | null
  companyIndustry?: string | null
  sponsorshipSignal?: string | null
  matchedSkills?: string[] | null
  missingSkills?: string[] | null
  matchScore?: number | null
  matchLabel?: string | null
  sourceUrl?: string | null
  applyUrl?: string | null
  externalJobId?: string | null
  url: string
  ats: ATSProvider
}

// ── Autofill field ─────────────────────────────────────────────────────────────

export type FieldInputType =
  | "text"
  | "email"
  | "tel"
  | "url"
  | "select"
  | "checkbox"
  | "radio"
  | "textarea"
  | "file"
  | "number"
  | "date"

export interface DetectedField {
  elementRef: string
  label: string
  type: FieldInputType
  currentValue: string
  detectedValue: string
  confidence: number
  suggestedProfileKey: string | null
  needsReview: boolean
}

// ── Extension ↔ content script messages ──────────────────────────────────────

export type ContentMessageType =
  | "DETECT_PAGE"
  | "EXTRACT_JOB"
  | "DETECT_FORM_FIELDS"
  | "FILL_FORM_FIELDS"
  | "INJECT_RESUME_FILE"

export interface DetectPageMessage { type: "DETECT_PAGE" }
export interface ExtractJobMessage { type: "EXTRACT_JOB" }
export interface DetectFormFieldsMessage {
  type: "DETECT_FORM_FIELDS"
  /** Safe autofill profile to match against */
  profile: ExtensionSafeProfile
}
export interface FillFormFieldsMessage {
  type: "FILL_FORM_FIELDS"
  fields: Array<{ elementRef: string; value: string }>
}

export interface InjectResumeFileContentMessage {
  type:     "INJECT_RESUME_FILE"
  base64:   string
  filename: string
}

export type ContentMessage =
  | DetectPageMessage
  | ExtractJobMessage
  | DetectFormFieldsMessage
  | FillFormFieldsMessage
  | InjectResumeFileContentMessage

// Safe profile subset the extension receives
export interface ExtensionSafeProfile {
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  linkedin_url: string | null
  github_url: string | null
  portfolio_url: string | null
  website_url: string | null
  city: string | null
  state: string | null
  zip_code: string | null
  country: string | null
  address_line1: string | null
  address_line2: string | null
  authorized_to_work: boolean | null
  requires_sponsorship: boolean | null
  sponsorship_statement: string | null
  work_authorization: string | null
  years_of_experience: number | null
  salary_expectation_min: number | null
  salary_expectation_max: number | null
  earliest_start_date: string | null
  willing_to_relocate: boolean | null
  highest_degree: string | null
  field_of_study: string | null
  university: string | null
  graduation_year: number | null
  gpa: string | null
  preferred_work_type: string | null
  // EEO fields — only populated when the user has opted in via auto_fill_diversity
  auto_fill_diversity: boolean
  gender: string | null
  ethnicity: string | null
  veteran_status: string | null
  disability_status: string | null
}

export type ContentResponseType =
  | "PAGE_DETECTED"
  | "JOB_EXTRACTED"
  | "FORM_FIELDS_DETECTED"
  | "FORM_FILLED"
  | "INJECT_RESUME_FILE_RESULT"
  | "ERROR"

export interface PageDetectedResponse {
  type: "PAGE_DETECTED"
  page: DetectedPage
}

export interface JobExtractedResponse {
  type: "JOB_EXTRACTED"
  job: ExtractedJob
}

export interface FormFieldsDetectedResponse {
  type: "FORM_FIELDS_DETECTED"
  formFound: boolean
  fields: DetectedField[]
}

export interface FormFilledResponse {
  type: "FORM_FILLED"
  filledCount: number
  skippedCount: number
}

export interface ErrorResponse {
  type: "ERROR"
  message: string
}

export type ContentResponse =
  | PageDetectedResponse
  | JobExtractedResponse
  | FormFieldsDetectedResponse
  | FormFilledResponse
  | InjectResumeFileResult
  | ErrorResponse

// ── Background ↔ popup messages ───────────────────────────────────────────────

export type BackgroundMessageType =
  | "GET_SESSION"
  | "RESOLVE_JOB"
  | "SAVE_JOB"
  | "GET_PAGE_INFO"
  | "GET_AUTOFILL_PREVIEW"
  | "EXECUTE_AUTOFILL"
  | "GET_TAILOR_PREVIEW"
  | "APPROVE_TAILORED_RESUME"
  | "GENERATE_COVER_LETTER"
  | "FILL_COVER_LETTER"
  | "GET_SCOUT_OVERLAY"
  | "LIST_RESUMES"
  | "GET_WORKFLOW_STATE"
  | "GET_ACTIVE_CONTEXT"
  | "RELAY_SCOUT_COMMAND"
  | "QUEUE_GET_STATE"
  | "QUEUE_ADD_JOB"
  | "QUEUE_SKIP_JOB"
  | "QUEUE_RETRY_JOB"
  | "QUEUE_MARK_SUBMITTED"
  | "QUEUE_APPROVE_RESUME"
  | "QUEUE_PAUSE"
  | "QUEUE_RESUME"
  | "QUEUE_CLEAR"
  | "OPERATOR_OPEN_TAB"
  | "FETCH_RESUME_FILE"
  | "INJECT_RESUME_FILE_IN_TAB"

export interface ExtensionResumeSummary {
  id: string
  name: string
  isPrimary: boolean
  score: number | null
}

export interface GetSessionMessage {
  type: "GET_SESSION"
}

export interface SaveJobMessage {
  type: "SAVE_JOB"
  job: ExtractedJob
}

export interface ResolveJobMessage {
  type: "RESOLVE_JOB"
  fingerprint: ExtensionJobFingerprint
}

export interface GetPageInfoMessage {
  type: "GET_PAGE_INFO"
}

export interface GetAutofillPreviewMessage {
  type: "GET_AUTOFILL_PREVIEW"
}

export interface ExecuteAutofillMessage {
  type: "EXECUTE_AUTOFILL"
  fields: Array<{ elementRef: string; value: string }>
}

export interface GetTailorPreviewMessage {
  type: "GET_TAILOR_PREVIEW"
  jobId: string
  resumeId?: string
  /** Detected ATS system (workday | greenhouse | lever | ashby | icims | smartrecruiters | bamboohr | generic) */
  ats?: string
}

export interface ApproveTailoredResumeMessage {
  type: "APPROVE_TAILORED_RESUME"
  jobId: string
  resumeId?: string
  ats?: string
}

export interface GenerateCoverLetterMessage {
  type: "GENERATE_COVER_LETTER"
  jobId: string
  resumeId?: string
  ats?: string
}

export interface FillCoverLetterMessage {
  type: "FILL_COVER_LETTER"
  /** CSS selector for the textarea to fill */
  elementRef: string
  text: string
}

export interface GetScoutOverlayMessage {
  type: "GET_SCOUT_OVERLAY"
  jobId: string
}

export interface ListResumesMessage {
  type: "LIST_RESUMES"
}

export interface ListResumesResult {
  type: "LIST_RESUMES_RESULT"
  resumes: ExtensionResumeSummary[]
}

export type ScoutOverlayInsightsPayload = {
  ok: true
  matchPercent: number | null
  sponsorshipLikely: boolean | null
  sponsorshipLabel: string | null
  visaInsight: string | null
  missingSkills: string[]
  resumeAlignmentNote: string | null
  autofillReady: boolean
  jobIntelligenceStale: boolean
}

export type ScoutOverlayResult =
  | ({ type: "SCOUT_OVERLAY_RESULT" } & ScoutOverlayInsightsPayload)
  | { type: "SCOUT_OVERLAY_RESULT"; ok: false; error?: string; message?: string }

// ── Apply Queue ────────────────────────────────────────────────────────────────

export type QueueItemStatus =
  | "queued"
  | "tailoring"
  | "waiting_resume_approval"
  | "cover_letter_ready"
  | "autofill_ready"
  | "waiting_user_review"
  | "submitted_manually"
  | "failed"
  | "skipped"

export interface QueueJobWarning {
  code: string
  message: string
  severity: "info" | "warning" | "error"
}

export interface QueueJobEntry {
  queueId: string
  jobId?: string | null
  jobTitle: string
  company?: string | null
  applyUrl: string
  matchScore?: number | null
  sponsorshipSignal?: string | null
  status: QueueItemStatus
  resumeVersionId?: string | null
  resumeId?: string | null
  coverLetter?: string | null
  failReason?: string | null
  warnings?: QueueJobWarning[]
  addedAt: string
  preparedAt?: string | null
}

export interface ApplyQueueState {
  queueId: string
  jobs: QueueJobEntry[]
  paused: boolean
  createdAt: string
}

export interface QueueGetStateMessage { type: "QUEUE_GET_STATE" }

export interface QueueAddJobMessage {
  type: "QUEUE_ADD_JOB"
  job: {
    jobId?: string | null
    jobTitle: string
    company?: string | null
    applyUrl: string
    matchScore?: number | null
    sponsorshipSignal?: string | null
  }
}

export interface QueueSkipJobMessage   { type: "QUEUE_SKIP_JOB";   queueId: string }
export interface QueueRetryJobMessage  { type: "QUEUE_RETRY_JOB";  queueId: string }

export interface QueueMarkSubmittedMessage {
  type: "QUEUE_MARK_SUBMITTED"
  queueId: string
}

export interface QueueApproveResumeMessage {
  type: "QUEUE_APPROVE_RESUME"
  queueId: string
  versionId: string
  resumeId: string
}

export interface QueuePauseMessage  { type: "QUEUE_PAUSE" }
export interface QueueResumeMessage { type: "QUEUE_RESUME" }
export interface QueueClearMessage  { type: "QUEUE_CLEAR" }

export interface QueueStateResult {
  type: "QUEUE_STATE_RESULT"
  queue: ApplyQueueState | null
}

export interface QueueAddResult {
  type: "QUEUE_ADD_RESULT"
  queueId: string
  status: QueueItemStatus
  warnings?: QueueJobWarning[]
  failReason?: string | null
}

export interface QueueActionResult { type: "QUEUE_ACTION_RESULT"; ok: boolean }

export type BackgroundMessage =
  | GetSessionMessage
  | ResolveJobMessage
  | SaveJobMessage
  | GetPageInfoMessage
  | GetAutofillPreviewMessage
  | ExecuteAutofillMessage
  | GetTailorPreviewMessage
  | ApproveTailoredResumeMessage
  | GenerateCoverLetterMessage
  | FillCoverLetterMessage
  | GetScoutOverlayMessage
  | ListResumesMessage
  | GetWorkflowStateMessage
  | GetActiveContextMessage
  | RelayScoutCommandMessage
  | QueueGetStateMessage
  | QueueAddJobMessage
  | QueueSkipJobMessage
  | QueueRetryJobMessage
  | QueueMarkSubmittedMessage
  | QueueApproveResumeMessage
  | QueuePauseMessage
  | QueueResumeMessage
  | QueueClearMessage
  | OperatorOpenTabMessage
  | FetchResumeFileMessage
  | InjectResumeFileInTabMessage

export interface OperatorOpenTabMessage {
  type:           "OPERATOR_OPEN_TAB"
  url:            string
  jobId?:         string
  jobTitle?:      string
  company?:       string
  coverLetterId?: string
  agentMode?:     boolean
}

export interface OperatorOpenTabAck {
  type: "OPERATOR_OPEN_TAB_ACK"
}

export interface FetchResumeFileMessage {
  type:     "FETCH_RESUME_FILE"
  resumeId: string
}

/** One-shot: background fetches the PDF and injects it into the sender's tab */
export interface InjectResumeFileInTabMessage {
  type:     "INJECT_RESUME_FILE_IN_TAB"
  resumeId: string
}

export interface InjectResumeFileInTabResult {
  type:      "INJECT_RESUME_FILE_IN_TAB_RESULT"
  injected:  boolean
  selector?: string
  error?:    string
}

export interface FetchResumeFileResult {
  type:       "FETCH_RESUME_FILE_RESULT"
  base64?:    string        // base64-encoded PDF
  filename?:  string
  error?:     string
}

// Sent from background → content script to inject a resume file into the page
export interface InjectResumeFileMessage {
  type:     "INJECT_RESUME_FILE"
  base64:   string
  filename: string
}

export interface InjectResumeFileResult {
  type:      "INJECT_RESUME_FILE_RESULT"
  injected:  boolean
  selector?: string    // which input was found
  error?:    string
}

export interface ExtensionSessionUser {
  id: string
  email: string | null
  /** From `profiles.full_name` when available */
  fullName?: string | null
  /** From `profiles.avatar_url` — same origin or absolute URL */
  avatarUrl?: string | null
}

export interface SessionResult {
  type: "SESSION_RESULT"
  authenticated: boolean
  user: ExtensionSessionUser | null
}

export interface SaveResult {
  type: "SAVE_RESULT"
  saved: boolean
  jobId?: string
  hireovanUrl?: string
  error?: string
}

export interface ResolveJobResult {
  type: "RESOLVE_JOB_RESULT"
  exists: boolean
  jobId?: string
  status: "found" | "created" | "needs_import"
}

export interface PageInfoResult {
  type: "PAGE_INFO_RESULT"
  page: DetectedPage | null
  job: ExtractedJob | null
}

export interface AutofillPreviewResult {
  type: "AUTOFILL_PREVIEW_RESULT"
  formFound: boolean
  ats: string
  totalFields: number
  matchedFields: number
  reviewFields: number
  fields: DetectedField[]
  profileMissing: boolean
}

export interface AutofillExecuteResult {
  type: "AUTOFILL_EXECUTE_RESULT"
  filledCount: number
  skippedCount: number
}

export interface BackgroundError {
  type: "ERROR"
  message: string
}

// ── Tailor preview / approve ───────────────────────────────────────────────────

export type TailorPreviewStatus = "ready" | "missing_resume" | "missing_job_context" | "gated"

export interface TailorChangePreview {
  section: "summary" | "skills" | "experience" | "ats_tip"
  before?: string
  after?: string
  reason: string
}

export interface TailorPreviewResult {
  type: "TAILOR_PREVIEW_RESULT"
  status: TailorPreviewStatus
  summary: string
  atsTip: string | null
  atsName: string | null
  resumeId: string | null
  resumeName: string | null
  jobTitle: string | null
  company: string | null
  matchScore: number | null
  changesPreview: TailorChangePreview[]
  error?: string
}

export interface TailorApproveResult {
  type: "TAILOR_APPROVE_RESULT"
  success: boolean
  versionId?: string
  versionName?: string
  resumeId?: string
  matchScore?: number | null
  error?: string
}

export interface CoverLetterResult {
  type: "COVER_LETTER_RESULT"
  success: boolean
  coverLetter?: string
  jobTitle?: string | null
  company?: string | null
  source?: "ai" | "template"
  error?: string
}

export interface FillCoverLetterResult {
  type: "FILL_COVER_LETTER_RESULT"
  success: boolean
}

export type BackgroundResponse =
  | SessionResult
  | ResolveJobResult
  | SaveResult
  | PageInfoResult
  | AutofillPreviewResult
  | AutofillExecuteResult
  | TailorPreviewResult
  | TailorApproveResult
  | CoverLetterResult
  | FillCoverLetterResult
  | ScoutOverlayResult
  | ListResumesResult
  | WorkflowStateResult
  | ActiveContextResult
  | RelayScoutCommandResult
  | QueueStateResult
  | QueueAddResult
  | QueueActionResult
  | OperatorOpenTabAck
  | FetchResumeFileResult
  | InjectResumeFileInTabResult
  | BackgroundError

// ── Active browser context ────────────────────────────────────────────────────
//
// Built from live page detection in the background service worker and pushed
// to hireoven.com tabs so Scout can adapt its UI to the user's active tab.

export type ActiveBrowserPageType =
  | "search_results"
  | "job_detail"
  | "application_form"
  | "company_page"
  | "unknown"

export interface ActiveBrowserContext {
  pageType: ActiveBrowserPageType
  atsProvider?: ATSProvider
  url: string
  title?: string
  company?: string
  location?: string
  detectedJobId?: string
  autofillAvailable?: boolean
  detectedFieldsCount?: number
  timestamp: number
}

/** Background → hireoven content script: push context with named events to broadcast */
export interface BroadcastContextMessage {
  type: "BROADCAST_CONTEXT"
  context: ActiveBrowserContext | null
  /**
   * Spec-named events to broadcast as separate window.postMessage calls:
   *   ACTIVE_CONTEXT_CHANGED — always sent
   *   AUTOFILL_AVAILABLE     — when pageType changes to application_form
   *   JOB_RESOLVED           — when detectedJobId first appears
   *   PAGE_MODE_CHANGED      — when pageType changes from a previous value
   */
  events: string[]
}

/** Popup / hireoven page bridge → background: request stored context */
export interface GetActiveContextMessage {
  type: "GET_ACTIVE_CONTEXT"
}

/** Background → requester: current stored active browser context */
export interface ActiveContextResult {
  type: "ACTIVE_CONTEXT_RESULT"
  context: ActiveBrowserContext | null
}

// ── Review submitted notification ─────────────────────────────────────────────

/** Posted by the extension to hireoven.com via window.postMessage when the user
 *  clicks "Mark submitted" in the Final Review panel on the job site. */
export interface ReviewSubmittedMessage {
  type:         "hireoven:review-submitted"
  jobId?:       string
  queueItemId?: string
}

/** Scout commands that hireoven.com page can send to the extension */
export type ScoutExtensionCommandType =
  | "OPEN_AUTOFILL"
  | "START_TAILOR"
  | "START_COMPARE"
  | "START_WORKFLOW"

/** Content script on hireoven.com → background: relay a Scout UI command to the active job tab */
export interface RelayScoutCommandMessage {
  type: "RELAY_SCOUT_COMMAND"
  command: ScoutExtensionCommandType
  payload?: Record<string, unknown>
}

/** Background → content script on job site: execute a Scout command */
export interface ExecuteScoutCommandMessage {
  type: "EXECUTE_SCOUT_COMMAND"
  command: ScoutExtensionCommandType
  payload?: Record<string, unknown>
}

export interface RelayScoutCommandResult {
  type: "RELAY_SCOUT_COMMAND_RESULT"
  delivered: boolean
}

// ── Workflow extension state ──────────────────────────────────────────────────
//
// The extension content script can POST this state to the Scout dashboard
// via window.postMessage when it detects a relevant page change.
// The dashboard listens for "hireoven:extension-page-state" messages and
// can update the active workflow step status accordingly.

export interface WorkflowExtensionPageState {
  pageMode: ExtensionPageMode
  autofillReady: boolean
  fieldsDetected: boolean
  ats: ATSProvider
  jobContext?: {
    jobId?: string
    title?: string | null
    company?: string | null
    url: string
  }
  timestamp: number
}

export interface GetWorkflowStateMessage {
  type: "GET_WORKFLOW_STATE"
}

export interface WorkflowStateResult {
  type: "WORKFLOW_STATE_RESULT"
  state: WorkflowExtensionPageState | null
}

// ── API shapes (matching web app routes) ─────────────────────────────────────

export interface ExtensionSessionValidateResponse {
  authenticated: boolean
  user: ExtensionSessionUser | null
}

export interface ExtensionJobImportRequest {
  title: string | null
  company: string | null
  location: string | null
  description: string | null
  salary: string | null
  url: string
  ats: ATSProvider
}

export interface ExtensionJobFingerprint {
  sourceUrl: string
  applyUrl: string
  atsProvider: ATSProvider | string
  externalJobId?: string | null
  title: string | null
  company: string | null
}

export interface ExtensionJobResolveResponse {
  exists: boolean
  jobId?: string
  status: "found" | "created" | "needs_import"
}

export interface ExtensionJobImportResponse {
  saved: boolean
  jobId?: string
  hireovanUrl?: string
  error?: string
}

export interface ExtensionTailorPreviewResponse {
  status: TailorPreviewStatus
  summary: string
  atsTip: string | null
  atsName: string | null
  resumeId: string | null
  resumeName: string | null
  jobTitle: string | null
  company: string | null
  matchScore: number | null
  changesPreview: TailorChangePreview[]
}

export interface ExtensionTailorApproveResponse {
  versionId: string
  versionName: string
  resumeId: string
  matchScore: number | null
  changesApplied: number
}

export interface ExtensionCoverLetterResponse {
  coverLetter: string
  jobTitle: string | null
  company: string | null
  source: "ai" | "template"
}
