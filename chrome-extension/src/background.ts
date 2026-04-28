/**
 * Hireoven Scout Bridge — Background Service Worker (MV3)
 *
 * Mediates between the popup and content scripts.
 * Makes authenticated API calls to hireoven.com using the session cookie.
 *
 * Auth strategy:
 *   1. Read the `ho_session` JWT cookie from hireoven.com via chrome.cookies.
 *   2. Send it as `Authorization: Bearer <token>` on every extension API request.
 *   3. The web app validates the JWT server-side — no new auth flow needed.
 */

import type {
  BackgroundMessage,
  BackgroundResponse,
  ContentMessage,
  ContentResponse,
  ExtractedJob,
  ExtensionSafeProfile,
  SessionResult,
  SaveResult,
  PageInfoResult,
  AutofillPreviewResult,
  AutofillExecuteResult,
  TailorPreviewResult,
  TailorApproveResult,
  CoverLetterResult,
  FillCoverLetterResult,
  ExtensionTailorPreviewResponse,
  ExtensionTailorApproveResponse,
  ExtensionCoverLetterResponse,
} from "./types"

// ── Config ─────────────────────────────────────────────────────────────────────

const APP_ORIGINS = [
  "http://localhost:3000",
  "https://hireoven.com",
] as const

const SESSION_COOKIE_NAME = "ho_session"

// ── Session-scoped tailor state ────────────────────────────────────────────────
// Cleared when background SW restarts; stored in chrome.storage.local for cross-popup persistence.
// approvedResumeVersionId is written on approve and can be read by future autofill calls.

let approvedResumeVersionId: string | null = null
let approvedResumeId: string | null = null

function persistTailorState() {
  void chrome.storage.local.set({
    approvedResumeVersionId,
    approvedResumeId,
  })
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Resolve the active hireoven origin. Defaults to localhost:3000. */
async function resolveOrigin(): Promise<string> {
  const result = await chrome.storage.local.get("devMode")
  // devMode=false explicitly → production. Otherwise default to localhost.
  return result.devMode === false ? APP_ORIGINS[1] : APP_ORIGINS[0]
}

/** Get the session JWT from hireoven.com cookies. */
async function getSessionToken(origin: string): Promise<string | null> {
  const url = origin + "/"
  try {
    const cookie = await chrome.cookies.get({ url, name: SESSION_COOKIE_NAME })
    return cookie?.value ?? null
  } catch {
    return null
  }
}

/** Make an authenticated request to the extension API. */
async function apiRequest<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown
): Promise<T | null> {
  const origin = await resolveOrigin()
  const token = await getSessionToken(origin)
  if (!token) return null

  try {
    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      "X-Hireoven-Extension": "1",
    }
    if (body !== undefined) {
      headers["Content-Type"] = "application/json"
    }

    const res = await fetch(`${origin}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    const contentType = res.headers.get("content-type") ?? ""
    const payload = contentType.includes("application/json")
      ? ((await res.json().catch(() => null)) as T | { message?: string; error?: string } | null)
      : null
    if (!res.ok) {
      const message = payload && typeof payload === "object" && "message" in payload
        ? payload.message
        : payload && typeof payload === "object" && "error" in payload
        ? payload.error
        : `Request failed with status ${res.status}`
      console.warn(`[Hireoven extension] ${method} ${path}: ${message}`)
      return null
    }
    return payload as T
  } catch (err) {
    console.warn(`[Hireoven extension] ${method} ${path} failed`, err)
    return null
  }
}

// ── Content script bridge ──────────────────────────────────────────────────────

async function queryContentScript(
  tabId: number,
  message: ContentMessage
): Promise<ContentResponse | null> {
  try {
    // Ensure the content script is injected (handles tabs opened before the extension).
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["dist/content.js"],
    })
  } catch {
    // Script may already be injected — that's fine.
  }

  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response: ContentResponse | undefined) => {
      if (chrome.runtime.lastError) {
        resolve(null)
        return
      }
      resolve(response ?? null)
    })
  })
}

// ── Message handler ────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (
    message: BackgroundMessage,
    _sender,
    sendResponse: (response: BackgroundResponse) => void
  ) => {
    handleMessage(message).then(sendResponse)
    return true // keep the message channel open for async response
  }
)

async function handleMessage(message: BackgroundMessage): Promise<BackgroundResponse> {
  switch (message.type) {
    case "GET_SESSION":
      return handleGetSession()

    case "GET_PAGE_INFO":
      return handleGetPageInfo()

    case "SAVE_JOB":
      return handleSaveJob(message.job)

    case "GET_AUTOFILL_PREVIEW":
      return handleGetAutofillPreview()

    case "EXECUTE_AUTOFILL":
      return handleExecuteAutofill(message.fields)

    case "GET_TAILOR_PREVIEW":
      return handleGetTailorPreview(message.jobId, message.resumeId, message.ats)

    case "APPROVE_TAILORED_RESUME":
      return handleApproveTailoredResume(message.jobId, message.resumeId, message.ats)

    case "GENERATE_COVER_LETTER":
      return handleGenerateCoverLetter(message.jobId, message.resumeId, message.ats)

    case "FILL_COVER_LETTER":
      return handleFillCoverLetter(message.elementRef, message.text)
  }
}

async function handleGetSession(): Promise<SessionResult> {
  const data = await apiRequest<{
    authenticated: boolean
    user: { id: string; email: string | null } | null
  }>("GET", "/api/extension/session/validate")

  if (!data) {
    return { type: "SESSION_RESULT", authenticated: false, user: null }
  }
  return { type: "SESSION_RESULT", authenticated: data.authenticated, user: data.user }
}

async function handleGetPageInfo(): Promise<PageInfoResult> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) {
    return { type: "PAGE_INFO_RESULT", page: null, job: null }
  }

  const pageResponse = await queryContentScript(tab.id, { type: "DETECT_PAGE" })
  if (!pageResponse || pageResponse.type !== "PAGE_DETECTED") {
    return { type: "PAGE_INFO_RESULT", page: null, job: null }
  }

  const jobResponse = await queryContentScript(tab.id, { type: "EXTRACT_JOB" })
  const job = jobResponse?.type === "JOB_EXTRACTED" ? jobResponse.job : null

  return { type: "PAGE_INFO_RESULT", page: pageResponse.page, job }
}

async function handleSaveJob(job: ExtractedJob): Promise<SaveResult> {
  const origin = await resolveOrigin()
  const data = await apiRequest<{ saved: boolean; jobId?: string }>(
    "POST",
    "/api/extension/jobs/import",
    job
  )

  if (!data || !data.saved) {
    return { type: "SAVE_RESULT", saved: false, error: "Failed to save job." }
  }

  const hireovanUrl = data.jobId ? `${origin}/dashboard/jobs/${data.jobId}` : undefined
  return { type: "SAVE_RESULT", saved: true, jobId: data.jobId, hireovanUrl }
}

// ── Autofill preview ──────────────────────────────────────────────────────────

async function handleGetAutofillPreview(): Promise<AutofillPreviewResult> {
  const empty: AutofillPreviewResult = {
    type: "AUTOFILL_PREVIEW_RESULT",
    formFound: false,
    ats: "generic",
    totalFields: 0,
    matchedFields: 0,
    reviewFields: 0,
    fields: [],
    profileMissing: false,
  }

  // 1. Fetch safe autofill profile
  const profileData = await apiRequest<{ profile: ExtensionSafeProfile | null; profileMissing: boolean }>(
    "GET",
    "/api/extension/autofill-profile"
  )
  if (!profileData || !profileData.profile) {
    return { ...empty, profileMissing: true }
  }

  // 2. Get active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) return empty

  // 3. Ensure content script is loaded
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["dist/content.js"] })
  } catch { /* already injected */ }

  // 4. Get detected page ATS
  const pageResponse = await queryContentScript(tab.id, { type: "DETECT_PAGE" })
  const ats = pageResponse?.type === "PAGE_DETECTED" ? pageResponse.page.ats : "generic"

  // 5. Send form detection request to content script
  const fieldsResponse = await queryContentScript(tab.id, {
    type: "DETECT_FORM_FIELDS",
    profile: profileData.profile,
  } as ContentMessage)

  if (!fieldsResponse || fieldsResponse.type !== "FORM_FIELDS_DETECTED") return empty

  const { formFound, fields } = fieldsResponse
  const matchedFields = fields.filter((f) => f.detectedValue && !f.needsReview).length
  const reviewFields = fields.filter((f) => f.needsReview || (f.suggestedProfileKey === "resume" || f.suggestedProfileKey === "cover_letter")).length

  return {
    type: "AUTOFILL_PREVIEW_RESULT",
    formFound,
    ats,
    totalFields: fields.length,
    matchedFields,
    reviewFields,
    fields,
    profileMissing: false,
  }
}

async function handleExecuteAutofill(
  fieldsToFill: Array<{ elementRef: string; value: string }>
): Promise<AutofillExecuteResult> {
  const empty: AutofillExecuteResult = { type: "AUTOFILL_EXECUTE_RESULT", filledCount: 0, skippedCount: 0 }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) return empty

  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["dist/content.js"] })
  } catch { /* already injected */ }

  const response = await queryContentScript(tab.id, {
    type: "FILL_FORM_FIELDS",
    fields: fieldsToFill,
  } as ContentMessage)

  if (!response || response.type !== "FORM_FILLED") return empty

  return {
    type: "AUTOFILL_EXECUTE_RESULT",
    filledCount: response.filledCount,
    skippedCount: response.skippedCount,
  }
}

// ── Tailor preview ────────────────────────────────────────────────────────────

async function handleGetTailorPreview(
  jobId: string,
  resumeId?: string,
  ats?: string
): Promise<TailorPreviewResult> {
  const emptyError = (msg: string): TailorPreviewResult => ({
    type: "TAILOR_PREVIEW_RESULT",
    status: "missing_job_context",
    summary: msg,
    atsTip: null,
    atsName: null,
    resumeId: null,
    resumeName: null,
    jobTitle: null,
    company: null,
    matchScore: null,
    changesPreview: [],
    error: msg,
  })

  const data = await apiRequest<ExtensionTailorPreviewResponse>(
    "POST",
    "/api/extension/resume/tailor-preview",
    { jobId, resumeId, ats }
  )

  if (!data) return emptyError("Could not reach Hireoven. Check your connection.")

  return {
    type: "TAILOR_PREVIEW_RESULT",
    status: data.status,
    summary: data.summary,
    atsTip: data.atsTip ?? null,
    atsName: data.atsName ?? null,
    resumeId: data.resumeId,
    resumeName: data.resumeName,
    jobTitle: data.jobTitle,
    company: data.company,
    matchScore: data.matchScore,
    changesPreview: data.changesPreview,
  }
}

async function handleApproveTailoredResume(
  jobId: string,
  resumeId?: string,
  ats?: string
): Promise<TailorApproveResult> {
  const data = await apiRequest<ExtensionTailorApproveResponse>(
    "POST",
    "/api/extension/resume/tailor-approve",
    { jobId, resumeId, ats }
  )

  if (!data) {
    return {
      type: "TAILOR_APPROVE_RESULT",
      success: false,
      error: "Could not create tailored resume version. Check your connection.",
    }
  }

  // Store approved version in session state and persist to local storage
  approvedResumeVersionId = data.versionId
  approvedResumeId = data.resumeId
  persistTailorState()

  return {
    type: "TAILOR_APPROVE_RESULT",
    success: true,
    versionId: data.versionId,
    versionName: data.versionName,
    resumeId: data.resumeId,
    matchScore: data.matchScore,
  }
}

// ── Cover letter ──────────────────────────────────────────────────────────────

async function handleGenerateCoverLetter(
  jobId: string,
  resumeId?: string,
  ats?: string
): Promise<CoverLetterResult> {
  const data = await apiRequest<ExtensionCoverLetterResponse>(
    "POST",
    "/api/extension/cover-letter/generate",
    { jobId, resumeId, ats }
  )

  if (!data) {
    return {
      type: "COVER_LETTER_RESULT",
      success: false,
      error: "Could not generate cover letter. Check your connection and try again.",
    }
  }

  return {
    type: "COVER_LETTER_RESULT",
    success: true,
    coverLetter: data.coverLetter,
    jobTitle: data.jobTitle,
    company: data.company,
    source: data.source,
  }
}

async function handleFillCoverLetter(
  elementRef: string,
  text: string
): Promise<FillCoverLetterResult> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) return { type: "FILL_COVER_LETTER_RESULT", success: false }

  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["dist/content.js"] })
  } catch { /* already injected */ }

  const response = await queryContentScript(tab.id, {
    type: "FILL_FORM_FIELDS",
    fields: [{ elementRef, value: text }],
  } as ContentMessage)

  return {
    type: "FILL_COVER_LETTER_RESULT",
    success: response?.type === "FORM_FILLED" && response.filledCount > 0,
  }
}

// ── Extension install / update lifecycle ──────────────────────────────────────

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install") {
    chrome.tabs.create({ url: "https://hireoven.com/dashboard" })
  }
})
