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
  location: string | null
  description: string | null
  salary: string | null
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
  | "SAVE_JOB"
  | "GET_PAGE_INFO"
  | "GET_AUTOFILL_PREVIEW"
  | "EXECUTE_AUTOFILL"

export interface GetSessionMessage {
  type: "GET_SESSION"
}

export interface SaveJobMessage {
  type: "SAVE_JOB"
  job: ExtractedJob
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

export type BackgroundMessage =
  | GetSessionMessage
  | SaveJobMessage
  | GetPageInfoMessage
  | GetAutofillPreviewMessage
  | ExecuteAutofillMessage

export type BackgroundResponseType =
  | "SESSION_RESULT"
  | "SAVE_RESULT"
  | "PAGE_INFO_RESULT"
  | "AUTOFILL_PREVIEW_RESULT"
  | "AUTOFILL_EXECUTE_RESULT"
  | "ERROR"

export interface SessionResult {
  type: "SESSION_RESULT"
  authenticated: boolean
  user: { id: string; email: string | null } | null
}

export interface SaveResult {
  type: "SAVE_RESULT"
  saved: boolean
  jobId?: string
  hireovanUrl?: string
  error?: string
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

export type BackgroundResponse =
  | SessionResult
  | SaveResult
  | PageInfoResult
  | AutofillPreviewResult
  | AutofillExecuteResult
  | BackgroundError

// ── API shapes (matching web app routes) ─────────────────────────────────────

export interface ExtensionSessionValidateResponse {
  authenticated: boolean
  user: { id: string; email: string | null } | null
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

export interface ExtensionJobImportResponse {
  saved: boolean
  jobId?: string
  hireovanUrl?: string
  error?: string
}
