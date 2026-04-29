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

export type ContentMessage =
  | DetectPageMessage
  | ExtractJobMessage
  | DetectFormFieldsMessage
  | FillFormFieldsMessage

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
  | BackgroundError

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
