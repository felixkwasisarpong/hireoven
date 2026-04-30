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
  ActiveBrowserContext,
  ActiveContextResult,
  BackgroundMessage,
  BackgroundResponse,
  ContentMessage,
  ContentResponse,
  ExtractedJob,
  ExtensionSafeProfile,
  SessionResult,
  ResolveJobResult,
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
  ScoutOverlayResult,
  ScoutOverlayInsightsPayload,
  ExtensionJobFingerprint,
  ExtensionJobResolveResponse,
  ListResumesResult,
  ExtensionResumeSummary,
  WorkflowStateResult,
} from "./types"

// ── Config ─────────────────────────────────────────────────────────────────────

const APP_ORIGINS = [
  "http://localhost:3000",
  "https://hireoven.com",
] as const

const SESSION_COOKIE_NAME = "ho_session"

// ── Active browser context ─────────────────────────────────────────────────────
// Lightweight tab context built from page detection and pushed to hireoven.com
// tabs so Scout can adapt its UI to the user's current browsing state.

let activeContextCache: ActiveBrowserContext | null = null
let contextRefreshTimer: ReturnType<typeof setTimeout> | null = null

/** Map a detected page type to the ActiveBrowserContext page type. */
function mapPageType(
  pageType: string,
  ats: string,
  url: string,
): ActiveBrowserContext["pageType"] {
  if (pageType === "application_form") return "application_form"
  if (pageType === "job_listing") return "job_detail"
  // Search-result heuristic based on URL patterns
  if (
    /linkedin\.com\/jobs\/search/i.test(url) ||
    /glassdoor\.com\/job\//i.test(url) ||
    /indeed\.com\/(jobs|rc\/clk)/i.test(url)
  ) {
    return "search_results"
  }
  // ATS job boards are always job_detail or application_form
  if (["greenhouse", "lever", "ashby", "workday", "icims", "smartrecruiters", "bamboohr"].includes(ats)) {
    return "job_detail"
  }
  return "unknown"
}

async function buildContextFromTab(tabId: number, tabUrl: string): Promise<ActiveBrowserContext | null> {
  if (!/^https?:/.test(tabUrl)) return null
  // Skip hireoven itself — that's the Scout dashboard, not an external job page
  if (/hireoven\.com|localhost:3000/.test(tabUrl)) return null

  try {
    const pageResp = await queryContentScript(tabId, { type: "DETECT_PAGE" })
    if (!pageResp || pageResp.type !== "PAGE_DETECTED") return null

    const page = pageResp.page
    const pageType = mapPageType(page.pageType, page.ats, page.url)

    let company: string | undefined
    let title: string | undefined

    if (pageType === "job_detail" || pageType === "application_form") {
      const jobResp = await queryContentScript(tabId, { type: "EXTRACT_JOB" })
      if (jobResp?.type === "JOB_EXTRACTED" && jobResp.job) {
        company = jobResp.job.company ?? undefined
        title = jobResp.job.title ?? undefined
      }
    }

    return {
      pageType,
      atsProvider: page.ats !== "generic" ? (page.ats as ActiveBrowserContext["atsProvider"]) : undefined,
      url: page.url,
      title: title || page.title || undefined,
      company,
      autofillAvailable: pageType === "application_form",
      timestamp: Date.now(),
    }
  } catch {
    return null
  }
}

async function pushContextToHireovenTabs(context: ActiveBrowserContext | null): Promise<void> {
  const origin = await resolveOrigin()
  const patterns =
    origin === APP_ORIGINS[1]
      ? ["https://hireoven.com/*", "https://www.hireoven.com/*"]
      : ["http://localhost:3000/*"]

  for (const pattern of patterns) {
    try {
      const tabs = await chrome.tabs.query({ url: pattern })
      for (const tab of tabs) {
        if (!tab.id) continue
        chrome.tabs.sendMessage(tab.id, { type: "BROADCAST_CONTEXT", context }).catch(() => {})
      }
    } catch {
      // no matching tabs or query error — skip silently
    }
  }
}

function scheduleContextRefresh(tabId: number, tabUrl: string, delayMs = 700): void {
  if (contextRefreshTimer) clearTimeout(contextRefreshTimer)
  contextRefreshTimer = setTimeout(() => {
    contextRefreshTimer = null
    buildContextFromTab(tabId, tabUrl)
      .then((context) => {
        activeContextCache = context
        void pushContextToHireovenTabs(context)
      })
      .catch(() => {})
  }, delayMs)
}

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

/** Get the session JWT from hireoven cookies (apex + www fallback for production). */
async function getSessionToken(origin: string): Promise<string | null> {
  const urls = [`${origin}/`]
  if (origin === APP_ORIGINS[1]) {
    urls.push("https://www.hireoven.com/")
  }
  for (const url of urls) {
    try {
      const cookie = await chrome.cookies.get({ url, name: SESSION_COOKIE_NAME })
      if (cookie?.value) return cookie.value
    } catch {
      // try next
    }
  }
  return null
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
  const send = (): Promise<ContentResponse | null> =>
    new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, message, (response: ContentResponse | undefined) => {
        if (chrome.runtime.lastError) {
          resolve(null)
          return
        }
        resolve(response ?? null)
      })
    })

  // Prefer messaging first to avoid duplicate content-script executions.
  const direct = await send()
  if (direct) return direct

  // Fallback: inject once, then retry the message.
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["dist/content.js"],
    })
  } catch {
    // Injection may be blocked on this host or already available; retry message anyway.
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
    sender,
    sendResponse: (response: BackgroundResponse) => void,
  ) => {
    handleMessage(message, sender).then(sendResponse).catch(() => {
      sendResponse({ type: "ERROR", message: "Unhandled error" })
    })
    return true // keep the message channel open for async response
  },
)

async function handleMessage(
  message: BackgroundMessage,
  sender: chrome.runtime.MessageSender,
): Promise<BackgroundResponse> {
  switch (message.type) {
    case "GET_SESSION":
      return handleGetSession()

    case "GET_PAGE_INFO":
      return handleGetPageInfo()

    case "SAVE_JOB":
      return handleSaveJob(message.job)

    case "RESOLVE_JOB":
      return handleResolveJob(message.fingerprint)

    case "GET_AUTOFILL_PREVIEW":
      return handleGetAutofillPreview(sender)

    case "EXECUTE_AUTOFILL":
      return handleExecuteAutofill(message.fields, sender)

    case "GET_TAILOR_PREVIEW":
      return handleGetTailorPreview(message.jobId, message.resumeId, message.ats)

    case "APPROVE_TAILORED_RESUME":
      return handleApproveTailoredResume(message.jobId, message.resumeId, message.ats)

    case "GENERATE_COVER_LETTER":
      return handleGenerateCoverLetter(message.jobId, message.resumeId, message.ats)

    case "FILL_COVER_LETTER":
      return handleFillCoverLetter(message.elementRef, message.text)

    case "GET_SCOUT_OVERLAY":
      return handleGetScoutOverlay(message.jobId)

    case "LIST_RESUMES":
      return handleListResumes()

    case "GET_ACTIVE_CONTEXT":
      return handleGetActiveContext()

    case "GET_WORKFLOW_STATE":
      return { type: "WORKFLOW_STATE_RESULT", state: null } as WorkflowStateResult

    default:
      return {
        type: "ERROR",
        message: "Unknown extension message type",
      }
  }
}

async function handleGetScoutOverlay(jobId: string): Promise<ScoutOverlayResult> {
  const origin = await resolveOrigin()
  const token = await getSessionToken(origin)
  if (!token) {
    return { type: "SCOUT_OVERLAY_RESULT", ok: false, error: "no_session" }
  }

  try {
    const res = await fetch(
      `${origin}/api/extension/jobs/${encodeURIComponent(jobId)}/scout-overlay`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
          "X-Hireoven-Extension": "1",
        },
      },
    )
    const payload = (await res.json().catch(() => null)) as Record<string, unknown> | null
    if (!payload || typeof payload !== "object") {
      return { type: "SCOUT_OVERLAY_RESULT", ok: false, error: "parse" }
    }

    if (payload.ok === false) {
      return {
        type: "SCOUT_OVERLAY_RESULT",
        ok: false,
        error: typeof payload.error === "string" ? payload.error : "not_ready",
        message: typeof payload.message === "string" ? payload.message : undefined,
      }
    }

    if (payload.ok === true) {
      const p = payload as unknown as ScoutOverlayInsightsPayload
      return {
        type: "SCOUT_OVERLAY_RESULT",
        ok: true,
        matchPercent: p.matchPercent,
        sponsorshipLikely: p.sponsorshipLikely,
        sponsorshipLabel: p.sponsorshipLabel,
        visaInsight: p.visaInsight,
        missingSkills: p.missingSkills,
        resumeAlignmentNote: p.resumeAlignmentNote,
        autofillReady: p.autofillReady,
        jobIntelligenceStale: p.jobIntelligenceStale,
      }
    }
  } catch {
    /* ignore */
  }

  return { type: "SCOUT_OVERLAY_RESULT", ok: false, error: "unreachable" }
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

async function handleResolveJob(fingerprint: ExtensionJobFingerprint): Promise<ResolveJobResult> {
  const data = await apiRequest<ExtensionJobResolveResponse>(
    "POST",
    "/api/extension/jobs/resolve",
    fingerprint,
  )

  if (!data) {
    return {
      type: "RESOLVE_JOB_RESULT",
      exists: false,
      status: "needs_import",
    }
  }

  return {
    type: "RESOLVE_JOB_RESULT",
    exists: Boolean(data.exists),
    jobId: data.jobId,
    status: data.status,
  }
}

// ── Autofill preview ──────────────────────────────────────────────────────────

async function resolveTargetTabId(sender: chrome.runtime.MessageSender): Promise<number | undefined> {
  if (sender.tab?.id != null) return sender.tab.id
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true })
  return active?.id
}

async function handleGetAutofillPreview(sender: chrome.runtime.MessageSender): Promise<AutofillPreviewResult> {
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

  // 2. Target tab — content script callers must supply sender.tab (popup uses active tab)
  const tabId = await resolveTargetTabId(sender)
  if (tabId == null) return empty

  // 3. Get detected page ATS
  const pageResponse = await queryContentScript(tabId, { type: "DETECT_PAGE" })
  const ats = pageResponse?.type === "PAGE_DETECTED" ? pageResponse.page.ats : "generic"

  // 4. Send form detection request to content script
  const fieldsResponse = await queryContentScript(tabId, {
    type: "DETECT_FORM_FIELDS",
    profile: profileData.profile,
  } as ContentMessage)

  if (!fieldsResponse || fieldsResponse.type !== "FORM_FIELDS_DETECTED") return empty

  const { formFound, fields } = fieldsResponse
  const matchedFields = fields.filter((f) => f.detectedValue && !f.needsReview).length
  const reviewFields = fields.filter(
    (f) => f.needsReview || f.suggestedProfileKey === "resume" || f.suggestedProfileKey === "cover_letter",
  ).length

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
  fieldsToFill: Array<{ elementRef: string; value: string }>,
  sender: chrome.runtime.MessageSender,
): Promise<AutofillExecuteResult> {
  const empty: AutofillExecuteResult = { type: "AUTOFILL_EXECUTE_RESULT", filledCount: 0, skippedCount: 0 }

  const tabId = await resolveTargetTabId(sender)
  if (tabId == null) return empty

  const response = await queryContentScript(tabId, {
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

  const response = await queryContentScript(tab.id, {
    type: "FILL_FORM_FIELDS",
    fields: [{ elementRef, value: text }],
  } as ContentMessage)

  return {
    type: "FILL_COVER_LETTER_RESULT",
    success: response?.type === "FORM_FILLED" && response.filledCount > 0,
  }
}

async function handleListResumes(): Promise<ListResumesResult> {
  interface RawResume {
    id: string
    name: string | null
    file_name: string
    is_primary: boolean
    resume_score: number | null
    ats_score: number | null
    archived_at: string | null
  }

  const rows = await apiRequest<RawResume[]>("GET", "/api/resume")
  if (!rows || !Array.isArray(rows)) {
    return { type: "LIST_RESUMES_RESULT", resumes: [] }
  }

  const resumes: ExtensionResumeSummary[] = rows
    .filter((r) => !r.archived_at)
    .map((r) => ({
      id: r.id,
      name: r.name ?? r.file_name,
      isPrimary: Boolean(r.is_primary),
      score: r.ats_score ?? r.resume_score ?? null,
    }))

  return { type: "LIST_RESUMES_RESULT", resumes }
}

function handleGetActiveContext(): ActiveContextResult {
  return { type: "ACTIVE_CONTEXT_RESULT", context: activeContextCache }
}

// ── Tab monitoring ─────────────────────────────────────────────────────────────
// Track the active tab to keep activeContextCache fresh.
// Debounced so rapid navigations (SPA route changes) don't flood the content script.

chrome.tabs.onActivated.addListener((info) => {
  chrome.tabs.get(info.tabId, (tab) => {
    if (chrome.runtime.lastError || !tab.url) return
    scheduleContextRefresh(info.tabId, tab.url, 900)
  })
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !tab.active || !tab.url) return
  scheduleContextRefresh(tabId, tab.url, 400)
})

// ── Extension install / update lifecycle ──────────────────────────────────────

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install") {
    chrome.tabs.create({ url: "https://hireoven.com/dashboard" })
  }
})
