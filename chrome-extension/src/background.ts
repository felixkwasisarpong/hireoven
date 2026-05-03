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
  ApplyQueueState,
  BackgroundMessage,
  BackgroundResponse,
  ContentMessage,
  ContentResponse,
  ExtractedJob,
  ExtensionSafeProfile,
  QueueActionResult,
  QueueAddResult,
  QueueItemStatus,
  QueueJobEntry,
  QueueStateResult,
  RelayScoutCommandResult,
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
  FetchResumeFileResult,
  InjectResumeFileInTabResult,
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

/**
 * Most recently active tab that was a supported JOB page (not hireoven itself).
 * Used to relay Scout→Extension commands to the right destination tab.
 */
let lastJobTabId: number | null = null

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

/**
 * Build the list of spec-named events to broadcast alongside a context update.
 * The content script posts each event as a separate window.postMessage so the
 * dashboard hook can react to fine-grained signals.
 */
function buildEventNames(
  next: ActiveBrowserContext | null,
  prev: ActiveBrowserContext | null,
): string[] {
  const events: string[] = ["ACTIVE_CONTEXT_CHANGED"]
  if (!next) return events

  if (next.autofillAvailable && !prev?.autofillAvailable) {
    events.push("AUTOFILL_AVAILABLE")
  }
  if (next.detectedJobId && !prev?.detectedJobId) {
    events.push("JOB_RESOLVED")
  }
  if (prev && next.pageType !== prev.pageType) {
    events.push("PAGE_MODE_CHANGED")
  }
  return events
}

async function pushContextToHireovenTabs(
  context: ActiveBrowserContext | null,
  events: string[],
): Promise<void> {
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
        chrome.tabs.sendMessage(tab.id, { type: "BROADCAST_CONTEXT", context, events }).catch(() => {})
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
        const prev = activeContextCache
        activeContextCache = context
        // Track which tab most recently had a job page so we can relay Scout commands to it
        if (context && context.pageType !== "unknown") {
          lastJobTabId = tabId
        }
        const events = buildEventNames(context, prev)
        void pushContextToHireovenTabs(context, events)
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

// ── Apply Queue storage ────────────────────────────────────────────────────────

const QUEUE_STORAGE_KEY = "applyQueue"

async function readQueue(): Promise<ApplyQueueState | null> {
  try {
    const result = await chrome.storage.local.get(QUEUE_STORAGE_KEY)
    const raw = result[QUEUE_STORAGE_KEY] as Record<string, unknown> | null | undefined
    if (raw && typeof raw === "object" && Array.isArray((raw as Record<string, unknown>).jobs)) {
      return raw as unknown as ApplyQueueState
    }
  } catch {
    // storage unavailable
  }
  return null
}

async function writeQueue(queue: ApplyQueueState | null): Promise<void> {
  try {
    if (queue) {
      await chrome.storage.local.set({ [QUEUE_STORAGE_KEY]: queue })
    } else {
      await chrome.storage.local.remove(QUEUE_STORAGE_KEY)
    }
  } catch {
    // storage unavailable
  }
}

function makeQueueItemId(): string {
  return `qi-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

function makeQueueId(): string {
  return `aq-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Resolve the active hireoven origin.
 *
 * Default is auto-detected by install type:
 *   - Unpacked / "Load unpacked" (no `update_url` in manifest) → localhost:3000
 *   - Chrome Web Store install (has `update_url`)              → hireoven.com
 *
 * Override via chrome.storage.local:
 *   chrome.storage.local.set({ devMode: true })   → force localhost:3000
 *   chrome.storage.local.set({ devMode: false })  → force hireoven.com
 */
function isUnpackedInstall(): boolean {
  return !chrome.runtime.getManifest().update_url
}

async function resolveOrigin(): Promise<string> {
  const result = await chrome.storage.local.get("devMode")
  if (result.devMode === true) return APP_ORIGINS[0]
  if (result.devMode === false) return APP_ORIGINS[1]
  return isUnpackedInstall() ? APP_ORIGINS[0] : APP_ORIGINS[1]
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
  method: "GET" | "POST" | "PATCH",
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
    // Don't claim Scout MVP messages — they have a dedicated listener below.
    // Without this guard, the default case here resolves first and overrides
    // the MVP listener's async response (Chrome's first-sendResponse-wins rule).
    const t = (message as { type?: unknown })?.type
    if (typeof t === "string" && t.startsWith("EXT_MVP_")) {
      return false
    }
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

    case "RELAY_SCOUT_COMMAND":
      return handleRelayScoutCommand(message.command, message.payload)

    case "FETCH_RESUME_FILE":
      return handleFetchResumeFile(message.resumeId as string)

    case "INJECT_RESUME_FILE_IN_TAB":
      return handleInjectResumeFileInTab(message.resumeId as string, sender)

    case "OPERATOR_OPEN_TAB":
      void handleOperatorOpenTab(
        message.url as string,
        message.jobId as string | undefined,
        message.jobTitle as string | undefined,
        message.company as string | undefined,
        message.coverLetterId as string | undefined,
        Boolean(message.agentMode),
      )
      return { type: "OPERATOR_OPEN_TAB_ACK" }

    case "GET_WORKFLOW_STATE":
      return { type: "WORKFLOW_STATE_RESULT", state: null } as WorkflowStateResult

    case "QUEUE_GET_STATE":
      return handleQueueGetState()

    case "QUEUE_ADD_JOB":
      return handleQueueAddJob(message.job)

    case "QUEUE_SKIP_JOB":
      return handleQueueSkipJob(message.queueId)

    case "QUEUE_RETRY_JOB":
      return handleQueueRetryJob(message.queueId)

    case "QUEUE_MARK_SUBMITTED":
      return handleQueueMarkSubmitted(message.queueId)

    case "QUEUE_APPROVE_RESUME":
      return handleQueueApproveResume(message.queueId, message.versionId, message.resumeId)

    case "QUEUE_PAUSE":
      return handleQueuePauseResume(true)

    case "QUEUE_RESUME":
      return handleQueuePauseResume(false)

    case "QUEUE_CLEAR":
      return handleQueueClear()

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

async function handleRelayScoutCommand(
  command: string,
  payload?: Record<string, unknown>,
): Promise<RelayScoutCommandResult> {
  if (!lastJobTabId) {
    return { type: "RELAY_SCOUT_COMMAND_RESULT", delivered: false }
  }
  try {
    await chrome.tabs.sendMessage(lastJobTabId, {
      type: "EXECUTE_SCOUT_COMMAND",
      command,
      payload: payload ?? {},
    })
    return { type: "RELAY_SCOUT_COMMAND_RESULT", delivered: true }
  } catch {
    lastJobTabId = null // tab was closed or unresponsive
    return { type: "RELAY_SCOUT_COMMAND_RESULT", delivered: false }
  }
}

// ── Resume file fetch (for DataTransfer injection) ────────────────────────────

async function handleFetchResumeFile(resumeId: string): Promise<FetchResumeFileResult> {
  try {
    const origin = await resolveOrigin()
    const token  = await getSessionToken(origin)
    if (!token) return { type: "FETCH_RESUME_FILE_RESULT", error: "Not authenticated" }

    // Extension-auth endpoint — uses Bearer token, not cookie session
    const res = await fetch(`${origin}/api/extension/resume/download?resumeId=${encodeURIComponent(resumeId)}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Hireoven-Extension": "1",
      },
    })
    if (!res.ok) return { type: "FETCH_RESUME_FILE_RESULT", error: `HTTP ${res.status}` }

    const contentDisposition = res.headers.get("content-disposition") ?? ""
    const filenameMatch = contentDisposition.match(/filename[^;=\n]*=(["']?)([^"'\n;]+)\1/)
    const filename = filenameMatch?.[2]?.trim() ?? "resume.pdf"

    const buffer = await res.arrayBuffer()
    // Convert ArrayBuffer → base64 so it survives chrome.runtime.sendMessage serialization
    const bytes = new Uint8Array(buffer)
    let binary = ""
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
    const base64 = btoa(binary)

    return { type: "FETCH_RESUME_FILE_RESULT", base64, filename }
  } catch (err) {
    return { type: "FETCH_RESUME_FILE_RESULT", error: String(err) }
  }
}

async function handleInjectResumeFileInTab(
  resumeId: string,
  sender: chrome.runtime.MessageSender,
): Promise<InjectResumeFileInTabResult> {
  const fail = (error: string): InjectResumeFileInTabResult =>
    ({ type: "INJECT_RESUME_FILE_IN_TAB_RESULT", injected: false, error })

  const tabId = sender.tab?.id
  if (!tabId) return fail("No sender tab ID")

  const fileResult = await handleFetchResumeFile(resumeId)
  if (!fileResult.base64 || !fileResult.filename) return fail(fileResult.error ?? "PDF fetch failed")

  try {
    const response = await queryContentScript(tabId, {
      type:     "INJECT_RESUME_FILE",
      base64:   fileResult.base64,
      filename: fileResult.filename,
    } as import("./types").ContentMessage)

    if (!response || response.type !== "INJECT_RESUME_FILE_RESULT") return fail("No response from content script")
    return {
      type:      "INJECT_RESUME_FILE_IN_TAB_RESULT",
      injected:  response.injected,
      selector:  response.selector,
      error:     response.error,
    }
  } catch (err) {
    return fail(String(err))
  }
}

// ── Apply-agent tab opener ────────────────────────────────────────────────────

/** Pending agent contexts keyed by tab ID — sent to content script once the tab finishes loading */
const pendingAgentTabs = new Map<number, {
  jobId?:         string
  jobTitle?:      string
  company?:       string
  coverLetterId?: string
}>()

async function handleOperatorOpenTab(
  url:            string,
  jobId?:         string,
  jobTitle?:      string,
  company?:       string,
  coverLetterId?: string,
  agentMode = false,
): Promise<void> {
  if (!url) return
  const tab = await chrome.tabs.create({ url, active: true })
  if (!tab.id) return

  if (agentMode) {
    pendingAgentTabs.set(tab.id, { jobId, jobTitle, company, coverLetterId })
  }
}

// When a tab completes loading, check if it has a pending agent context and send autofill command
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== "complete") return
  const ctx = pendingAgentTabs.get(tabId)
  if (!ctx) return
  pendingAgentTabs.delete(tabId)

  // Brief delay to let the page's React app hydrate before we send the command
  setTimeout(() => {
    chrome.tabs.sendMessage(tabId, {
      type:          "EXECUTE_SCOUT_COMMAND",
      command:       "AGENT_AUTOFILL",
      payload:       ctx,
    }).catch(() => {
      // Content script not yet ready on this URL — not a supported ATS page
    })
  }, 1800)
})

// ── Apply Queue handlers ───────────────────────────────────────────────────────

async function handleQueueGetState(): Promise<QueueStateResult> {
  const queue = await readQueue()
  return { type: "QUEUE_STATE_RESULT", queue }
}

async function handleQueueAddJob(
  jobInput: {
    jobId?: string | null
    jobTitle: string
    company?: string | null
    applyUrl: string
    matchScore?: number | null
    sponsorshipSignal?: string | null
  },
): Promise<QueueAddResult> {
  // ── Hard safety gates ────────────────────────────────────────────────────────
  if (!jobInput.applyUrl?.trim()) {
    return { type: "QUEUE_ADD_RESULT", queueId: "", status: "failed", failReason: "No apply URL found" }
  }

  const sig = (jobInput.sponsorshipSignal ?? "").toLowerCase()
  if (/\bno\b|\bnone\b|\bnot\b|\bdoes not sponsor\b|\bwithout sponsorship\b/.test(sig)) {
    return {
      type: "QUEUE_ADD_RESULT",
      queueId: "",
      status: "failed",
      failReason: "Job explicitly offers no sponsorship",
    }
  }

  const queueItemId = makeQueueItemId()

  // ── Ensure queue exists ──────────────────────────────────────────────────────
  let queue = await readQueue()
  if (!queue) {
    queue = { queueId: makeQueueId(), jobs: [], paused: false, createdAt: new Date().toISOString() }
  }

  // ── Deduplicate by applyUrl ──────────────────────────────────────────────────
  const exists = queue.jobs.some((j) => j.applyUrl === jobInput.applyUrl)
  if (exists) {
    return {
      type: "QUEUE_ADD_RESULT",
      queueId: queueItemId,
      status: "queued",
      warnings: [{ code: "duplicate", message: "This job is already in the queue.", severity: "info" }],
    }
  }

  const newItem: QueueJobEntry = {
    queueId: queueItemId,
    jobId: jobInput.jobId ?? null,
    jobTitle: jobInput.jobTitle,
    company: jobInput.company ?? null,
    applyUrl: jobInput.applyUrl,
    matchScore: jobInput.matchScore ?? null,
    sponsorshipSignal: jobInput.sponsorshipSignal ?? null,
    status: "queued",
    addedAt: new Date().toISOString(),
  }

  queue.jobs.push(newItem)
  await writeQueue(queue)

  // ── Kick off bulk-prepare asynchronously ─────────────────────────────────────
  void prepareBulkJob(queueItemId, jobInput.jobId ?? null, jobInput).catch(() => {})

  return { type: "QUEUE_ADD_RESULT", queueId: queueItemId, status: "queued" }
}

async function prepareBulkJob(
  queueItemId: string,
  jobId: string | null,
  jobInput: { jobTitle: string; company?: string | null; applyUrl: string; sponsorshipSignal?: string | null },
): Promise<void> {
  const queue = await readQueue()
  if (!queue) return

  const itemIdx = queue.jobs.findIndex((j) => j.queueId === queueItemId)
  if (itemIdx < 0) return

  const updateStatus = async (status: QueueItemStatus, patch?: Partial<QueueJobEntry>) => {
    const q = await readQueue()
    if (!q) return
    const i = q.jobs.findIndex((j) => j.queueId === queueItemId)
    if (i < 0) return
    q.jobs[i] = { ...q.jobs[i], status, preparedAt: new Date().toISOString(), ...patch }
    await writeQueue(q)
  }

  await updateStatus("tailoring")

  try {
    const data = await apiRequest<{
      resumeTailorStatus?: string
      coverLetterStatus?: string
      autofillStatus?: string
      warnings?: Array<{ code: string; message: string; severity: "info" | "warning" | "error" }>
      failReason?: string
    }>("POST", "/api/scout/bulk-prepare", {
      jobId: jobId ?? undefined,
      jobTitle: jobInput.jobTitle,
      company: jobInput.company ?? undefined,
      applyUrl: jobInput.applyUrl,
      sponsorshipSignal: jobInput.sponsorshipSignal ?? undefined,
    })

    if (!data) {
      await updateStatus("failed", { failReason: "Preparation failed — network error" })
      return
    }

    if (data.failReason) {
      const failLabels: Record<string, string> = {
        missing_apply_url:           "No apply URL found",
        unsupported_ats:             "Unsupported ATS",
        missing_resume:              "No resume found — upload one in Hireoven",
        no_sponsorship_blocker:      "Job explicitly offers no sponsorship",
        expired_job:                 "Job listing may be expired",
        autofill_fields_unsupported: "Autofill not supported for this form",
        network_error:               "Preparation failed — can retry",
      }
      await updateStatus("failed", { failReason: failLabels[data.failReason] ?? data.failReason })
      return
    }

    const tailorOk = data.resumeTailorStatus === "ready"
    const coverOk  = data.coverLetterStatus  === "ready"

    let nextStatus: QueueItemStatus = "autofill_ready"
    if (tailorOk) nextStatus = "waiting_resume_approval"
    else if (coverOk) nextStatus = "cover_letter_ready"

    await updateStatus(nextStatus, {
      warnings: data.warnings as QueueJobEntry["warnings"],
    })
  } catch {
    await updateStatus("failed", { failReason: "Preparation failed — can retry" })
  }
}

async function handleQueueSkipJob(queueItemId: string): Promise<QueueActionResult> {
  const queue = await readQueue()
  if (!queue) return { type: "QUEUE_ACTION_RESULT", ok: false }
  const i = queue.jobs.findIndex((j) => j.queueId === queueItemId)
  if (i < 0) return { type: "QUEUE_ACTION_RESULT", ok: false }
  queue.jobs[i] = { ...queue.jobs[i], status: "skipped" }
  await writeQueue(queue)
  return { type: "QUEUE_ACTION_RESULT", ok: true }
}

async function handleQueueRetryJob(queueItemId: string): Promise<QueueActionResult> {
  const queue = await readQueue()
  if (!queue) return { type: "QUEUE_ACTION_RESULT", ok: false }
  const i = queue.jobs.findIndex((j) => j.queueId === queueItemId)
  if (i < 0) return { type: "QUEUE_ACTION_RESULT", ok: false }
  const job = queue.jobs[i]
  queue.jobs[i] = { ...job, status: "queued", failReason: null, preparedAt: null }
  await writeQueue(queue)
  // Re-kick preparation
  void prepareBulkJob(queueItemId, job.jobId ?? null, {
    jobTitle: job.jobTitle,
    company: job.company,
    applyUrl: job.applyUrl,
    sponsorshipSignal: job.sponsorshipSignal,
  }).catch(() => {})
  return { type: "QUEUE_ACTION_RESULT", ok: true }
}

async function handleQueueMarkSubmitted(queueItemId: string): Promise<QueueActionResult> {
  const queue = await readQueue()
  if (!queue) return { type: "QUEUE_ACTION_RESULT", ok: false }
  const i = queue.jobs.findIndex((j) => j.queueId === queueItemId)
  if (i < 0) return { type: "QUEUE_ACTION_RESULT", ok: false }
  const job = queue.jobs[i]
  queue.jobs[i] = { ...job, status: "submitted_manually" }
  await writeQueue(queue)

  // Fire-and-forget: record in web app
  void apiRequest("POST", "/api/scout/mark-submitted", {
    jobId: job.jobId ?? undefined,
    jobTitle: job.jobTitle,
    companyName: job.company ?? undefined,
    applyUrl: job.applyUrl,
    notes: "Submitted via Apply Queue",
  }).catch(() => {})

  return { type: "QUEUE_ACTION_RESULT", ok: true }
}

async function handleQueueApproveResume(
  queueItemId: string,
  versionId: string,
  resumeId: string,
): Promise<QueueActionResult> {
  const queue = await readQueue()
  if (!queue) return { type: "QUEUE_ACTION_RESULT", ok: false }
  const i = queue.jobs.findIndex((j) => j.queueId === queueItemId)
  if (i < 0) return { type: "QUEUE_ACTION_RESULT", ok: false }
  queue.jobs[i] = {
    ...queue.jobs[i],
    resumeVersionId: versionId,
    resumeId,
    status: "cover_letter_ready",
  }
  await writeQueue(queue)
  return { type: "QUEUE_ACTION_RESULT", ok: true }
}

async function handleQueuePauseResume(pause: boolean): Promise<QueueActionResult> {
  const queue = await readQueue()
  if (!queue) return { type: "QUEUE_ACTION_RESULT", ok: false }
  queue.paused = pause
  await writeQueue(queue)
  return { type: "QUEUE_ACTION_RESULT", ok: true }
}

async function handleQueueClear(): Promise<QueueActionResult> {
  await writeQueue(null)
  return { type: "QUEUE_ACTION_RESULT", ok: true }
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

// ── Scout MVP message channel ─────────────────────────────────────────────────
// Parallel to the typed BackgroundMessage channel above. Receives requests from
// the Scout Bar via api-client.ts and forwards them to the extension API,
// reusing the existing apiRequest() helper for auth.

type MvpApiResponse =
  | { ok: true; data: unknown }
  | { ok: false; error: string }

// Per-message routing config — different MVP messages map to different
// HTTP methods and request shapes.
type MvpRoute = {
  method: "GET" | "POST" | "PATCH"
  path: string
  buildBody?: (msg: Record<string, unknown>) => unknown
  buildQuery?: (msg: Record<string, unknown>) => string
}

const MVP_ROUTES: Record<string, MvpRoute> = {
  EXT_MVP_ANALYZE_JOB: {
    method: "POST",
    path: "/api/extension/jobs/analyze",
    buildBody: (msg) => msg.job,
  },
  EXT_MVP_SAVE_JOB: {
    method: "POST",
    path: "/api/extension/jobs/save",
    buildBody: (msg) => msg.job,
  },
  EXT_MVP_CHECK_JOB: {
    method: "GET",
    path: "/api/extension/jobs/check",
    buildQuery: (msg) => {
      const params = new URLSearchParams()
      if (typeof msg.url === "string")          params.set("url", msg.url)
      if (typeof msg.canonicalUrl === "string") params.set("canonicalUrl", msg.canonicalUrl)
      if (typeof msg.applyUrl === "string")     params.set("applyUrl", msg.applyUrl)
      const qs = params.toString()
      return qs ? `?${qs}` : ""
    },
  },
  EXT_MVP_GET_AUTOFILL_PROFILE: {
    method: "GET",
    path: "/api/extension/autofill-profile",
  },
  // Sentinel: handled separately below (binary response, not JSON).
  EXT_MVP_FETCH_PRIMARY_RESUME: {
    method: "GET",
    path: "/api/extension/resume/download",
  },
  EXT_MVP_GENERATE_COVER_LETTER: {
    method: "POST",
    path: "/api/extension/cover-letter/generate",
    buildBody: (msg) => ({ jobId: msg.jobId, resumeId: msg.resumeId, ats: msg.ats }),
  },
  EXT_MVP_UPDATE_COVER_LETTER: {
    method: "PATCH",
    path: "/api/extension/cover-letter",
    buildBody: (msg) => ({ body: msg.body, was_used: msg.was_used }),
    buildQuery: (msg) => `/${encodeURIComponent(String(msg.id ?? ""))}`,
  },
  // Sentinel: binary response, handled separately.
  EXT_MVP_FETCH_COVER_LETTER_DOCX: {
    method: "GET",
    path: "/api/extension/cover-letter/download",
  },
  EXT_MVP_SAVE_APPLICATION_PROOF: {
    method: "POST",
    path: "/api/extension/applications/proof",
    buildBody: (msg) => ({
      jobId:            msg.jobId,
      jobUrl:           msg.jobUrl,
      applyUrl:         msg.applyUrl,
      ats:              msg.ats,
      submittedAt:      msg.submittedAt,
      confirmationText: msg.confirmationText,
      resumeVersionId:  msg.resumeVersionId,
      coverLetterId:    msg.coverLetterId,
    }),
  },
}

/**
 * Fetch a resume's bytes (base64 + filename) for DataTransfer injection.
 * When `jobId` is provided, the download endpoint prefers a per-job
 * tailored copy (resumes.tailored_for_job_id = jobId) when one exists,
 * falling back to the user's primary resume.
 *
 * Goes outside apiRequest() because that helper assumes JSON responses;
 * the download endpoint streams a DOCX.
 */
async function fetchPrimaryResumeBytes(opts?: {
  jobId?: string
}): Promise<
  { ok: true; data: { base64: string; filename: string } } | { ok: false; error: string }
> {
  const params = new URLSearchParams()
  if (opts?.jobId) params.set("jobId", opts.jobId)
  return fetchBinaryDocx({
    path: "/api/extension/resume/download",
    query: params.toString(),
    notFoundMessage: "No resume found — upload one in Hireoven first.",
    fallbackFilename: "resume.docx",
  })
}

async function fetchCoverLetterDocxBytes(opts: {
  coverLetterId?: string
  jobId?: string
}): Promise<
  { ok: true; data: { base64: string; filename: string } } | { ok: false; error: string }
> {
  const params = new URLSearchParams()
  if (opts.coverLetterId) params.set("coverLetterId", opts.coverLetterId)
  else if (opts.jobId)    params.set("jobId", opts.jobId)
  return fetchBinaryDocx({
    path: "/api/extension/cover-letter/download",
    query: params.toString(),
    notFoundMessage: "Cover letter not found — generate one first.",
    fallbackFilename: "cover-letter.docx",
  })
}

/**
 * Generic helper: fetch an authenticated DOCX endpoint and return its bytes
 * as base64 + filename so the result survives chrome.runtime.sendMessage
 * structured cloning.
 */
async function fetchBinaryDocx(opts: {
  path: string
  query: string
  notFoundMessage: string
  fallbackFilename: string
}): Promise<
  { ok: true; data: { base64: string; filename: string } } | { ok: false; error: string }
> {
  try {
    const origin = await resolveOrigin()
    const token = await getSessionToken(origin)
    if (!token) return { ok: false, error: "Sign in to Hireoven to use Scout." }

    const url = `${origin}${opts.path}${opts.query ? `?${opts.query}` : ""}`
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Hireoven-Extension": "1",
      },
    })
    if (!res.ok) {
      if (res.status === 404) return { ok: false, error: opts.notFoundMessage }
      return { ok: false, error: `Fetch failed (HTTP ${res.status}).` }
    }

    const contentDisposition = res.headers.get("content-disposition") ?? ""
    const filenameMatch = contentDisposition.match(/filename[^;=\n]*=(["']?)([^"'\n;]+)\1/)
    const filename = filenameMatch?.[2]?.trim() ?? opts.fallbackFilename

    const buffer = await res.arrayBuffer()
    const bytes = new Uint8Array(buffer)
    let binary = ""
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
    const base64 = btoa(binary)
    return { ok: true, data: { base64, filename } }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

chrome.runtime.onMessage.addListener(
  (
    message: unknown,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (r: MvpApiResponse) => void,
  ): boolean => {
    if (typeof message !== "object" || message === null) return false
    const msg = message as Record<string, unknown>
    const type = typeof msg.type === "string" ? msg.type : null
    if (!type || !(type in MVP_ROUTES)) return false

    // Binary fetches — bypass apiRequest() (which only parses JSON) and use
    // the dedicated fetch+base64 helper.
    if (type === "EXT_MVP_FETCH_PRIMARY_RESUME") {
      const jobId = typeof msg.jobId === "string" ? msg.jobId : undefined
      void fetchPrimaryResumeBytes({ jobId }).then(sendResponse).catch((err: unknown) =>
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }),
      )
      return true
    }
    if (type === "EXT_MVP_FETCH_COVER_LETTER_DOCX") {
      const coverLetterId = typeof msg.coverLetterId === "string" ? msg.coverLetterId : undefined
      const jobId = typeof msg.jobId === "string" ? msg.jobId : undefined
      void fetchCoverLetterDocxBytes({ coverLetterId, jobId }).then(sendResponse).catch((err: unknown) =>
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }),
      )
      return true
    }

    const route = MVP_ROUTES[type]
    const path = route.buildQuery ? `${route.path}${route.buildQuery(msg)}` : route.path
    const body = route.buildBody ? route.buildBody(msg) : undefined

    void apiRequest<unknown>(route.method, path, body)
      .then((data) => {
        if (data === null) {
          sendResponse({ ok: false, error: "Sign in to Hireoven to use Scout." })
          return
        }
        sendResponse({ ok: true, data })
      })
      .catch((err: unknown) => {
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) })
      })
    return true // keep channel open for async sendResponse
  },
)

// ── Extension install / update lifecycle ──────────────────────────────────────

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install") {
    void resolveOrigin().then((origin) => {
      chrome.tabs.create({ url: `${origin}/dashboard` })
    })
  }
})
