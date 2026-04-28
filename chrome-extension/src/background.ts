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
} from "./types"

// ── Config ─────────────────────────────────────────────────────────────────────

const APP_ORIGINS = [
  "http://localhost:3000",
  "https://hireoven.com",
] as const

const SESSION_COOKIE_NAME = "ho_session"

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
    const res = await fetch(`${origin}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "X-Hireoven-Extension": "1",
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
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

// ── Extension install / update lifecycle ──────────────────────────────────────

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install") {
    chrome.tabs.create({ url: "https://hireoven.com/dashboard" })
  }
})
