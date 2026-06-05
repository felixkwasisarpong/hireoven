/**
 * Hireoven Apex Bridge — Background Service Worker (MV3)
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
  RelayApexCommandResult,
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
  ApexOverlayResult,
  ApexOverlayInsightsPayload,
  ExtensionJobFingerprint,
  ExtensionJobResolveResponse,
  ListResumesResult,
  ExtensionResumeSummary,
  WorkflowStateResult,
  FetchResumeFileResult,
  InjectResumeFileInTabResult,
} from "./types"

// ── Config ─────────────────────────────────────────────────────────────────────

const LOCAL_APP_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
] as const
const PROD_APP_ORIGIN = "https://hireoven.com" as const

const SESSION_COOKIE_NAME = "ho_session"

// ── Active browser context ─────────────────────────────────────────────────────
// Lightweight tab context built from page detection and pushed to hireoven.com
// tabs so Apex can adapt its UI to the user's current browsing state.

let activeContextCache: ActiveBrowserContext | null = null
let contextRefreshTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Most recently active tab that was a supported JOB page (not hireoven itself).
 * Used to relay Apex→Extension commands to the right destination tab.
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
  // Skip hireoven itself — that's the Apex dashboard, not an external job page
  if (isApexDashboardUrl(tabUrl)) return null

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
    origin === PROD_APP_ORIGIN
      ? ["https://hireoven.com/*", "https://www.hireoven.com/*"]
      : ["http://localhost:3000/*", "http://127.0.0.1:3000/*"]

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
        // Track which tab most recently had a job page so we can relay Apex commands to it
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

function isApexDashboardUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl)
    const host = parsed.hostname.toLowerCase()
    if (host === "hireoven.com" || host.endsWith(".hireoven.com")) return true
    if (host === "localhost" || host.endsWith(".localhost")) return true
    if (host === "127.0.0.1" || host === "0.0.0.0" || host === "::1" || host === "[::1]") return true
    return false
  } catch {
    return false
  }
}

async function resolveOrigin(): Promise<string> {
  const result = await chrome.storage.local.get("devMode")
  if (result.devMode === true) {
    for (const origin of LOCAL_APP_ORIGINS) {
      if (await hasSessionCookie(origin)) return origin
    }
    return LOCAL_APP_ORIGINS[0]
  }
  if (result.devMode === false) return PROD_APP_ORIGIN

  if (isUnpackedInstall()) {
    for (const origin of LOCAL_APP_ORIGINS) {
      if (await hasSessionCookie(origin)) return origin
    }
    // Keep unpacked installs pinned to local app origins by default.
    return LOCAL_APP_ORIGINS[0]
  }

  const preferred = PROD_APP_ORIGIN
  // Production install fallback: if hireoven.com has no active session,
  // prefer any available local dev session before returning the production
  // origin.
  if (await hasSessionCookie(preferred)) return preferred
  for (const fallback of LOCAL_APP_ORIGINS) {
    if (await hasSessionCookie(fallback)) return fallback
  }
  return preferred
}

async function hasSessionCookie(origin: string): Promise<boolean> {
  return (await getSessionToken(origin)) !== null
}

/** Get the session JWT from hireoven cookies (apex + www fallback for production). */
async function getSessionToken(origin: string): Promise<string | null> {
  const urls = [`${origin}/`]
  if (origin === PROD_APP_ORIGIN) {
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
  message: ContentMessage,
  frameId?: number,
): Promise<ContentResponse | null> {
  const send = (): Promise<ContentResponse | null> =>
    new Promise((resolve) => {
      const callback = (response: ContentResponse | undefined) => {
        if (chrome.runtime.lastError) {
          resolve(null)
          return
        }
        resolve(response ?? null)
      }
      if (frameId != null) {
        chrome.tabs.sendMessage(tabId, message, { frameId }, callback)
        return
      }
      chrome.tabs.sendMessage(tabId, message, callback)
    })

  // Prefer messaging first to avoid duplicate content-script executions.
  const direct = await send()
  if (direct) return direct

  // Fallback: inject once, then retry the message.
  try {
    await chrome.scripting.executeScript({
      target: frameId != null ? { tabId, frameIds: [frameId] } : { tabId },
      files: ["dist/content.js"],
    })
  } catch {
    // Injection may be blocked on this host or already available; retry message anyway.
  }

  return new Promise((resolve) => {
    const callback = (response: ContentResponse | undefined) => {
      if (chrome.runtime.lastError) {
        resolve(null)
        return
      }
      resolve(response ?? null)
    }
    if (frameId != null) {
      chrome.tabs.sendMessage(tabId, message, { frameId }, callback)
      return
    }
    chrome.tabs.sendMessage(tabId, message, callback)
  })
}

type AutofillFrameProbe = {
  hasForm: boolean
  inputCount: number
  textLikeCount: number
  fileCount: number
  href: string
}

async function resolveBestAutofillFrameId(tabId: number): Promise<number | undefined> {
  try {
    const probes = await chrome.scripting.executeScript<
      [],
      AutofillFrameProbe
    >({
      target: { tabId, allFrames: true },
      func: () => {
        const selectors = [
          "#grnhse_app form",
          "#application_form",
          "form#new_application",
          "form#application-form",
          "form.application--form",
          ".greenhouse-application",
          ".greenhouse-application form",
          "form[action*='greenhouse']",
          "form[action*='job-boards']",
          ".lever-apply-form",
          "form.application-form",
          "form[action*='lever']",
          "form[action*='ashby']",
          "form[action*='jobs.ashbyhq']",
          "._ashby-application-form",
          "._ashby-application-form-container form",
          "[data-testid='application-form']",
          "[data-automation-id='applicationSummaryStep']",
          "[data-automation-id='applyStep']",
          "[data-automation-id='applyFlow']",
          "[data-automation-id='applicationStep']",
          "[data-automation-id='stepContent']",
          "form[data-automation-id]",
          "form[action*='workday']",
          "form[action*='myworkday']",
          "#icims_content form",
          ".iCIMS_Content form",
          "#iCIMS_JobsWidget form",
          "form[action*='icims']",
          ".sr-apply-step",
          ".smartrecruiters-widget form",
          "#apply-form",
          "form[action*='smartrecruiters']",
          "#bamboohr-apply",
          ".BambooHR-ATS form",
          "#apply-form-card form",
          "form[action*='bamboohr']",
          "form[action*='apply']",
          "form[id*='apply']",
          "form[class*='apply']",
          "[id*='application-form']",
          "[class*='application-form']",
        ]

        const root =
          selectors
            .map((selector) => document.querySelector(selector))
            .find((node): node is Element => Boolean(node)) ??
          Array.from(document.querySelectorAll("form")).find((form) => {
            const textLikeCount = form.querySelectorAll(
              "input[type=text], input[type=email], input[type=tel], input[type=url], textarea, select",
            ).length
            const fileCount = form.querySelectorAll("input[type=file]").length
            return textLikeCount >= 2 || fileCount >= 1
          }) ??
          null

        const inputCount = root
          ? root.querySelectorAll(
              "input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]), select, textarea, [role='combobox'], [aria-haspopup='listbox']",
            ).length
          : 0
        const textLikeCount = root
          ? root.querySelectorAll("input[type=text], input[type=email], input[type=tel], input[type=url], textarea, select").length
          : 0
        const fileCount = root ? root.querySelectorAll("input[type=file]").length : 0

        return {
          hasForm: Boolean(root && (inputCount >= 2 || fileCount >= 1)),
          inputCount,
          textLikeCount,
          fileCount,
          href: location.href,
        }
      },
    })

    const best = probes
      .filter((probe) => probe.result?.hasForm)
      .sort((a, b) => {
        const scoreA = (a.result?.inputCount ?? 0) * 10 + (a.result?.fileCount ?? 0) * 5 + (a.result?.textLikeCount ?? 0)
        const scoreB = (b.result?.inputCount ?? 0) * 10 + (b.result?.fileCount ?? 0) * 5 + (b.result?.textLikeCount ?? 0)
        return scoreB - scoreA
      })[0]

    return best?.frameId
  } catch {
    return undefined
  }
}

// ── Message handler ────────────────────────────────────────────────────────────

import { dispatchApexMessage } from "./apex-dispatcher"
import { buildLinkedInSearchUrl } from "./apex-connection-scanner"
import type { ImportLinkedInProfileResult, ScanLinkedInConnectionsResult, ScannedConnection } from "./types"

// Aggregator handler messages (linkedin/glassdoor/indeed/handshake) flow
// through a dedicated dispatcher; register before the main listener so its
// `return true` keeps the channel open for async responses.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  return dispatchApexMessage(message, sender, sendResponse)
})

chrome.runtime.onMessage.addListener(
  (
    message: BackgroundMessage,
    sender,
    sendResponse: (response: BackgroundResponse) => void,
  ) => {
    // Don't claim Apex MVP messages — they have a dedicated listener below.
    // Without this guard, the default case here resolves first and overrides
    // the MVP listener's async response (Chrome's first-sendResponse-wins rule).
    const t = (message as { type?: unknown })?.type
    if (typeof t === "string" && t.startsWith("EXT_MVP_")) {
      return false
    }
    // Same exclusion for the aggregator dispatcher — its messages start with APEX_
    // and are handled by the listener above.
    if (typeof t === "string" && t.startsWith("APEX_")) {
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

    case "GET_APEX_OVERLAY":
      return handleGetApexOverlay(message.jobId)

    case "LIST_RESUMES":
      return handleListResumes()

    case "GET_ACTIVE_CONTEXT":
      return handleGetActiveContext()

    case "RELAY_APEX_COMMAND":
      return handleRelayApexCommand(message.command, message.payload)

    case "FETCH_RESUME_FILE":
      return handleFetchResumeFile({
        resumeId: typeof message.resumeId === "string" ? message.resumeId : undefined,
        versionId: typeof message.versionId === "string" ? message.versionId : undefined,
      })

    case "INJECT_RESUME_FILE_IN_TAB":
      return handleInjectResumeFileInTab({
        resumeId: typeof message.resumeId === "string" ? message.resumeId : undefined,
        versionId: typeof message.versionId === "string" ? message.versionId : undefined,
      }, sender)

    case "GET_STORED_LINKEDIN_URL": {
      // Fetch the user's stored LinkedIn URL from the brand profile.
      // Used by content script to verify it's on the user's own profile before syncing.
      const brandProfile = await apiRequest<{ profile?: { linkedin_url?: string | null } | null }>(
        "GET", "/api/brand/profile"
      )
      return { linkedinUrl: brandProfile?.profile?.linkedin_url ?? null }
    }

    case "SYNC_LINKEDIN_BRAND_PROFILE": {
      const p = (message as import("./types").SyncLinkedInBrandProfileMessage).profile
      void apiRequest("PATCH", "/api/brand/profile", {
        linkedin_url:             p.linkedinUrl,
        headline:                 p.headline,
        has_about_section:        p.hasAboutSection,
        skills_count:             p.skillsCount || null,
        recommendations_count:    p.recommendationsCount || null,
        estimated_connections:    p.connectionsEstimate,
        last_post_detected_at:    p.lastPostDetectedAt,
        days_since_last_activity: p.daysSinceLastActivity,
      })
      return { type: "OPERATOR_OPEN_TAB_ACK" } as const
    }

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

    case "SPA_NAVIGATION_COMPLETE":
      // Content script detected a client-side URL change (login → form redirect
      // without a full page reload). Retry pending agent autofill for this tab.
      if (sender.tab?.id) {
        void tryDispatchAgentAutofill(sender.tab.id)
      }
      return { ok: true }

    case "AGENT_APPLICATION_SUBMITTED":
      return handleAgentApplicationSubmitted(
        message.jobId,
        message.applyUrl,
        message.atsProvider,
        sender.tab?.id,
      )

    case "AGENT_RUN_STATUS":
      return handleAgentRunStatus(message.phase, message.reason, sender.tab?.id)

    case "AGENT_PENDING_CHECK":
      return handleAgentPendingCheck(sender.tab?.id)

    case "AGENT_JOB_CONSUMED":
      // The in-page agent run reached a terminal state. Drop the context so the
      // content-pull stops re-dispatching AGENT_AUTOFILL (the Ashby SPA loop).
      if (sender.tab?.id) void deleteAgentTab(sender.tab.id)
      return { ok: true }

    case "SCAN_LINKEDIN_CONNECTIONS":
      return handleScanLinkedInConnections(message.companyName)

    case "IMPORT_LINKEDIN_PROFILE":
      return handleImportLinkedInProfile(message.url)

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

    case "QUEUE_OPEN_JOB":
      return handleQueueOpenJob(message.queueId)

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

    case "QUEUE_START_RUN":
      return handleQueueStartRun()

    case "QUEUE_STOP_RUN":
      return handleQueueStopRun()

    default:
      return {
        type: "ERROR",
        message: "Unknown extension message type",
      }
  }
}

async function handleGetApexOverlay(jobId: string): Promise<ApexOverlayResult> {
  const origin = await resolveOrigin()
  const token = await getSessionToken(origin)
  if (!token) {
    return { type: "APEX_OVERLAY_RESULT", ok: false, error: "no_session" }
  }

  try {
    const res = await fetch(
      `${origin}/api/extension/jobs/${encodeURIComponent(jobId)}/apex-overlay`,
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
      return { type: "APEX_OVERLAY_RESULT", ok: false, error: "parse" }
    }

    if (payload.ok === false) {
      return {
        type: "APEX_OVERLAY_RESULT",
        ok: false,
        error: typeof payload.error === "string" ? payload.error : "not_ready",
        message: typeof payload.message === "string" ? payload.message : undefined,
      }
    }

    if (payload.ok === true) {
      const p = payload as unknown as ApexOverlayInsightsPayload
      return {
        type: "APEX_OVERLAY_RESULT",
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

  return { type: "APEX_OVERLAY_RESULT", ok: false, error: "unreachable" }
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
  const frameId = await resolveBestAutofillFrameId(tabId)

  // 3. Get detected page ATS
  const pageResponse = await queryContentScript(tabId, { type: "DETECT_PAGE" }, frameId)
  const ats = pageResponse?.type === "PAGE_DETECTED" ? pageResponse.page.ats : "generic"

  // 4. Send form detection request to content script
  const fieldsResponse = await queryContentScript(tabId, {
    type: "DETECT_FORM_FIELDS",
    profile: profileData.profile,
  } as ContentMessage, frameId)

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
  const frameId = await resolveBestAutofillFrameId(tabId)

  const response = await queryContentScript(tabId, {
    type: "FILL_FORM_FIELDS",
    fields: fieldsToFill,
  } as ContentMessage, frameId)

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
  const frameId = await resolveBestAutofillFrameId(tab.id)

  const response = await queryContentScript(tab.id, {
    type: "FILL_FORM_FIELDS",
    fields: [{ elementRef, value: text }],
  } as ContentMessage, frameId)

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

async function handleAgentApplicationSubmitted(
  jobId?: string,
  applyUrl?: string,
  atsProvider?: string,
  senderTabId?: number,
): Promise<{ type: "AGENT_APPLICATION_SUBMITTED_ACK"; accepted: boolean }> {
  // The job is done — drop its agent context so the pull/push loops stop.
  if (senderTabId !== undefined) void deleteAgentTab(senderTabId)

  // Single-job "Open & Fill": mark just that job, don't advance to others.
  if (senderTabId !== undefined && manualAgentTabs.has(senderTabId)) {
    const queueId = manualAgentTabs.get(senderTabId)!
    manualAgentTabs.delete(senderTabId)
    void markQueueItemSubmitted(queueId)
  } else {
    // Otherwise advance the autonomous run (if any) past the job that submitted.
    void advanceRunOnSubmit(senderTabId)
  }

  const normalizedAts =
    typeof atsProvider === "string" && atsProvider !== "generic"
      ? (atsProvider as ActiveBrowserContext["atsProvider"])
      : activeContextCache?.atsProvider

  const nextContext: ActiveBrowserContext = {
    pageType: "application_form",
    url: applyUrl ?? activeContextCache?.url ?? "about:blank",
    title: activeContextCache?.title,
    company: activeContextCache?.company,
    atsProvider: normalizedAts,
    detectedJobId: jobId ?? activeContextCache?.detectedJobId,
    autofillAvailable: true,
    timestamp: Date.now(),
  }

  activeContextCache = nextContext

  try {
    await pushContextToHireovenTabs(nextContext, ["AGENT_APPLICATION_SUBMITTED"])
    return { type: "AGENT_APPLICATION_SUBMITTED_ACK", accepted: true }
  } catch {
    return { type: "AGENT_APPLICATION_SUBMITTED_ACK", accepted: false }
  }
}

async function handleRelayApexCommand(
  command: string,
  payload?: Record<string, unknown>,
): Promise<RelayApexCommandResult> {
  if (!lastJobTabId) {
    return { type: "RELAY_APEX_COMMAND_RESULT", delivered: false }
  }
  try {
    await chrome.tabs.sendMessage(lastJobTabId, {
      type: "EXECUTE_APEX_COMMAND",
      command,
      payload: payload ?? {},
    })
    return { type: "RELAY_APEX_COMMAND_RESULT", delivered: true }
  } catch {
    lastJobTabId = null // tab was closed or unresponsive
    return { type: "RELAY_APEX_COMMAND_RESULT", delivered: false }
  }
}

// ── Resume file fetch (for DataTransfer injection) ────────────────────────────

async function handleFetchResumeFile(args: {
  resumeId?: string
  versionId?: string
}): Promise<FetchResumeFileResult> {
  try {
    if (!args.resumeId && !args.versionId) {
      return { type: "FETCH_RESUME_FILE_RESULT", error: "No resume ID or version ID provided" }
    }
    const origin = await resolveOrigin()
    const token  = await getSessionToken(origin)
    if (!token) return { type: "FETCH_RESUME_FILE_RESULT", error: "Not authenticated" }

    const params = new URLSearchParams()
    if (args.versionId) params.set("versionId", args.versionId)
    else if (args.resumeId) params.set("resumeId", args.resumeId)

    // Extension-auth endpoint — uses Bearer token, not cookie session
    const res = await fetch(`${origin}/api/extension/resume/download?${params.toString()}`, {
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
  args: {
    resumeId?: string
    versionId?: string
  },
  sender: chrome.runtime.MessageSender,
): Promise<InjectResumeFileInTabResult> {
  const fail = (error: string): InjectResumeFileInTabResult =>
    ({ type: "INJECT_RESUME_FILE_IN_TAB_RESULT", injected: false, error })

  const tabId = sender.tab?.id
  if (!tabId) return fail("No sender tab ID")

  const fileResult = await handleFetchResumeFile(args)
  if (!fileResult.base64 || !fileResult.filename) return fail(fileResult.error ?? "PDF fetch failed")

  try {
    const frameId = await resolveBestAutofillFrameId(tabId)
    const response = await queryContentScript(tabId, {
      type:     "INJECT_RESUME_FILE",
      base64:   fileResult.base64,
      filename: fileResult.filename,
    } as import("./types").ContentMessage, frameId)

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

interface AgentTabCtx {
  jobId?:         string
  jobTitle?:      string
  company?:       string
  coverLetterId?: string
  createdAt:      number
  attempts:       number
  inFlight:       boolean
}

/**
 * Pending agent contexts keyed by tab ID. Persisted to chrome.storage.session
 * (NOT an in-memory Map) because the MV3 service worker is torn down after ~30s
 * idle — which is exactly what happens while the user spends a minute on a login
 * page. An in-memory Map would be wiped on that teardown, so the agent could
 * never resume after sign-in. storage.session survives worker restarts and is
 * cleared when the browser closes.
 */
const AGENT_TABS_KEY = "pendingAgentTabs"

async function readAgentTabs(): Promise<Record<string, AgentTabCtx>> {
  try {
    const r = await chrome.storage.session.get(AGENT_TABS_KEY)
    const raw = r[AGENT_TABS_KEY]
    return raw && typeof raw === "object" ? (raw as Record<string, AgentTabCtx>) : {}
  } catch {
    return {}
  }
}

async function getAgentTab(tabId: number): Promise<AgentTabCtx | null> {
  const all = await readAgentTabs()
  return all[String(tabId)] ?? null
}

async function setAgentTab(tabId: number, ctx: AgentTabCtx): Promise<void> {
  const all = await readAgentTabs()
  all[String(tabId)] = ctx
  try {
    await chrome.storage.session.set({ [AGENT_TABS_KEY]: all })
  } catch {
    // session storage unavailable — agent resume becomes best-effort
  }
}

async function deleteAgentTab(tabId: number): Promise<void> {
  const all = await readAgentTabs()
  if (!(String(tabId) in all)) return
  delete all[String(tabId)]
  try {
    await chrome.storage.session.set({ [AGENT_TABS_KEY]: all })
  } catch {
    // ignore
  }
}

async function handleOperatorOpenTab(
  url:            string,
  jobId?:         string,
  jobTitle?:      string,
  company?:       string,
  coverLetterId?: string,
  agentMode = false,
): Promise<number | null> {
  if (!url) return null
  const tab = await chrome.tabs.create({ url, active: true })
  if (!tab.id) return null

  if (agentMode) {
    await setAgentTab(tab.id, {
      jobId,
      jobTitle,
      company,
      coverLetterId,
      createdAt: Date.now(),
      attempts: 0,
      inFlight: false,
    })
  }
  return tab.id
}

const AGENT_CONTEXT_TTL_MS = 10 * 60 * 1000
const AGENT_CONTEXT_MAX_ATTEMPTS = 30

async function tryDispatchAgentAutofill(tabId: number): Promise<void> {
  // Read fresh from storage.session every time — the worker may have restarted
  // since the context was created (e.g. during a long login).
  const ctx = await getAgentTab(tabId)
  if (!ctx) return
  if (ctx.inFlight) return

  // Expire stale contexts so we do not retry forever after abandoned flows.
  if (Date.now() - ctx.createdAt > AGENT_CONTEXT_TTL_MS || ctx.attempts >= AGENT_CONTEXT_MAX_ATTEMPTS) {
    await deleteAgentTab(tabId)
    return
  }

  ctx.inFlight = true
  ctx.attempts += 1
  await setAgentTab(tabId, ctx)

  // Brief delay to let the page hydrate before we send the command.
  await new Promise((resolve) => setTimeout(resolve, 900))

  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "EXECUTE_APEX_COMMAND",
      command: "AGENT_AUTOFILL",
      payload: {
        jobId: ctx.jobId,
        jobTitle: ctx.jobTitle,
        company: ctx.company,
        coverLetterId: ctx.coverLetterId,
      },
    }) as { type?: string; accepted?: boolean; waiting?: boolean } | undefined

    const isAlive = response?.type === "APEX_COMMAND_EXECUTED"
    const accepted = isAlive && response?.accepted === true
    if (accepted) {
      await deleteAgentTab(tabId)
      return
    }
    if (isAlive && response?.waiting === true) {
      // The content script is DELIBERATELY waiting (a sign-in page, or a redirect
      // between steps). Refresh the context + reset the retry budget so a slow
      // login (2FA, password reset) doesn't expire it before the user returns to
      // the form. Only the genuine waiting case gets an unbounded reset.
      const current = await getAgentTab(tabId)
      if (current) {
        current.createdAt = Date.now()
        current.attempts = 0
        current.inFlight = false
        await setAgentTab(tabId, current)
        return
      }
    }
    // isAlive but NOT waiting → a stuck dead-end (e.g. form never detected). Do
    // NOT reset attempts: let them accumulate toward AGENT_CONTEXT_MAX_ATTEMPTS
    // so we stop re-dispatching instead of looping forever.
  } catch {
    // Receiving end doesn't exist yet on intermediate pages (login/redirect).
    // Keep context so the next navigation-complete can retry.
  }
  // Clear the in-flight flag so the next navigation can retry.
  const current = await getAgentTab(tabId)
  if (current) {
    current.inFlight = false
    await setAgentTab(tabId, current)
  }
}

/**
 * Content-pull resume path: the in-page bar asks (on load and on a timer)
 * whether this tab has a pending agent job. This is the reliable
 * resume-after-login mechanism — it depends only on the persisted
 * storage.session context, not on a background event firing while the worker is
 * alive and the bar is ready.
 */
async function handleAgentPendingCheck(tabId?: number): Promise<import("./types").AgentPendingResult> {
  if (!tabId) return { type: "AGENT_PENDING_RESULT", pending: false }
  const ctx = await getAgentTab(tabId)
  if (!ctx) {
    console.debug("[ho-agent] pending-check: no context for tab", tabId)
    return { type: "AGENT_PENDING_RESULT", pending: false }
  }
  if (Date.now() - ctx.createdAt > AGENT_CONTEXT_TTL_MS) {
    await deleteAgentTab(tabId)
    console.debug("[ho-agent] pending-check: context expired for tab", tabId)
    return { type: "AGENT_PENDING_RESULT", pending: false }
  }
  // Keep the context fresh while it's actively being driven (long login + fill).
  ctx.createdAt = Date.now()
  await setAgentTab(tabId, ctx)
  console.debug("[ho-agent] pending-check: pending job for tab", tabId, ctx.jobTitle)
  return {
    type: "AGENT_PENDING_RESULT",
    pending: true,
    payload: {
      jobId: ctx.jobId,
      jobTitle: ctx.jobTitle,
      company: ctx.company,
      coverLetterId: ctx.coverLetterId,
    },
  }
}

// When a tab completes loading, try to dispatch pending agent autofill context.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== "complete") return
  void tryDispatchAgentAutofill(tabId)
})

// Clean up if the tab is closed before automation begins.
chrome.tabs.onRemoved.addListener((tabId) => {
  void deleteAgentTab(tabId)
  manualAgentTabs.delete(tabId)
  // If the user closes the tab the run is actively driving, treat it as a skip
  // for that job and move on so the loop never stalls. (When *we* close a tab to
  // advance, currentRunTabId is already nulled, so this won't fire for us.)
  if (tabId === currentRunTabId) {
    currentRunTabId = null
    void (async () => {
      const queue = await readQueue()
      if (!queue || queue.runStatus !== "running" || !queue.currentQueueId) return
      const i = queue.jobs.findIndex((j) => j.queueId === queue.currentQueueId)
      if (i >= 0 && !["submitted_manually", "skipped"].includes(queue.jobs[i].status)) {
        queue.jobs[i] = { ...queue.jobs[i], status: "skipped" }
        await writeQueue(queue)
      }
      await advanceRun()
    })()
  }
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
      coverLetterId?: string
      autofillStatus?: string
      warnings?: Array<{ code: string; message: string; severity: "info" | "warning" | "error" }>
      failReason?: string
    }>("POST", "/api/apex/bulk-prepare", {
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
      coverLetterId: data.coverLetterId ?? null,
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
  void apiRequest("POST", "/api/apex/mark-submitted", {
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
  if (pause) {
    // Halt the run loop: let the in-flight tab finish on its own, but don't open
    // the next job until the user resumes.
    if (queue.runStatus === "running") queue.runStatus = "paused"
    clearRunWatchdog()
    await writeQueue(queue)
  } else {
    if (queue.runStatus === "paused") queue.runStatus = "running"
    await writeQueue(queue)
    // Nothing in flight → kick the next job. Otherwise let it keep driving.
    if (queue.runStatus === "running" && !queue.currentQueueId) {
      void advanceRun()
    } else if (queue.currentQueueId) {
      armRunWatchdog(queue.currentQueueId)
    }
  }
  return { type: "QUEUE_ACTION_RESULT", ok: true }
}

async function handleQueueClear(): Promise<QueueActionResult> {
  clearRunWatchdog()
  currentRunTabId = null
  await writeQueue(null)
  return { type: "QUEUE_ACTION_RESULT", ok: true }
}

// ── Autonomous apply run orchestrator ────────────────────────────────────────
//
// Chains the existing single-job agent autofill (pendingAgentTabs →
// AGENT_AUTOFILL → multi-page fill+submit) across every eligible queued job:
// open job → agent fills & submits → AGENT_APPLICATION_SUBMITTED → advance.
// Pauses (does not advance) while a job waits on a sign-in page; a watchdog
// breaks stuck jobs so the loop can never hang forever.

/** Tab currently being driven by the run. Set to null right before we close it. */
let currentRunTabId: number | null = null
let runWatchdog: ReturnType<typeof setTimeout> | null = null
const RUN_WATCHDOG_MS = 10 * 60 * 1000 // mirrors AGENT_CONTEXT_TTL_MS

/**
 * Tabs opened by a single-job "Open & Fill" (agent mode, but NOT a chained run).
 * Maps tabId → queueId so the submit/fail signal updates that one job without
 * advancing to others.
 */
const manualAgentTabs = new Map<number, string>()

/** Mark a queue item submitted and record it server-side. Shared by run + manual. */
async function markQueueItemSubmitted(queueId: string): Promise<void> {
  const queue = await readQueue()
  if (!queue) return
  const i = queue.jobs.findIndex((j) => j.queueId === queueId)
  if (i < 0) return
  const job = queue.jobs[i]
  if (job.status === "submitted_manually") return
  queue.jobs[i] = { ...job, status: "submitted_manually", failReason: null }
  await writeQueue(queue)
  void apiRequest("POST", "/api/apex/mark-submitted", {
    jobId: job.jobId ?? undefined,
    jobTitle: job.jobTitle,
    companyName: job.company ?? undefined,
    applyUrl: job.applyUrl,
    notes: "Submitted via Apply Queue agent",
  }).catch(() => {})
}

/** Patch a single queue item's status (no side effects). */
async function setQueueItemStatus(
  queueId: string,
  status: QueueItemStatus,
  patch?: Partial<QueueJobEntry>,
): Promise<void> {
  const queue = await readQueue()
  if (!queue) return
  const i = queue.jobs.findIndex((j) => j.queueId === queueId)
  if (i < 0) return
  queue.jobs[i] = { ...queue.jobs[i], status, ...patch }
  await writeQueue(queue)
}

/** Statuses that are either terminal or mean a job is already in flight. */
const RUN_DONE_OR_BUSY: QueueItemStatus[] = [
  "submitted_manually",
  "skipped",
  "failed",
  "applying",
  "waiting_login",
]

function clearRunWatchdog(): void {
  if (runWatchdog) {
    clearTimeout(runWatchdog)
    runWatchdog = null
  }
}

function armRunWatchdog(queueItemId: string): void {
  clearRunWatchdog()
  runWatchdog = setTimeout(() => void onRunWatchdogFired(queueItemId), RUN_WATCHDOG_MS)
}

async function onRunWatchdogFired(queueItemId: string): Promise<void> {
  const queue = await readQueue()
  if (!queue || queue.runStatus !== "running" || queue.currentQueueId !== queueItemId) return
  const i = queue.jobs.findIndex((j) => j.queueId === queueItemId)
  if (i < 0) return
  // Never time a job out while it is legitimately waiting for the user to log in.
  if (queue.jobs[i].status === "waiting_login") {
    armRunWatchdog(queueItemId)
    return
  }
  queue.jobs[i] = { ...queue.jobs[i], status: "failed", failReason: "Timed out before submission" }
  await writeQueue(queue)
  await advanceRun()
}

/** Mark the in-flight job submitted (when the agent confirms) and move on. */
async function advanceRunOnSubmit(senderTabId?: number): Promise<void> {
  const queue = await readQueue()
  if (!queue || queue.runStatus !== "running" || !queue.currentQueueId) return
  if (senderTabId !== undefined && currentRunTabId !== null && senderTabId !== currentRunTabId) return

  await markQueueItemSubmitted(queue.currentQueueId)
  await advanceRun()
}

/**
 * Close the previous job's tab and open the next eligible job in agent mode.
 * When nothing is left, marks the run done.
 */
async function advanceRun(): Promise<void> {
  clearRunWatchdog()

  // Close the tab from the job we just finished (best-effort).
  if (currentRunTabId !== null) {
    const closing = currentRunTabId
    currentRunTabId = null
    void deleteAgentTab(closing)
    chrome.tabs.remove(closing).catch(() => {})
  }

  let queue = await readQueue()
  if (!queue) return
  if (queue.runStatus !== "running" || queue.paused) return

  const next = queue.jobs.find((j) => !RUN_DONE_OR_BUSY.includes(j.status))
  if (!next) {
    queue.runStatus = "done"
    queue.currentQueueId = null
    await writeQueue(queue)
    return
  }

  // Reserve the job before opening so concurrent signals can't double-open it.
  const idx = queue.jobs.findIndex((j) => j.queueId === next.queueId)
  queue.jobs[idx] = { ...next, status: "applying", failReason: null }
  queue.currentQueueId = next.queueId
  await writeQueue(queue)

  const tabId = await handleOperatorOpenTab(
    next.applyUrl,
    next.jobId ?? undefined,
    next.jobTitle,
    next.company ?? undefined,
    next.coverLetterId ?? undefined, // attach the cover letter prepared by bulk-prepare
    true, // agentMode → background drives AGENT_AUTOFILL page-after-page
  )
  currentRunTabId = tabId

  if (tabId === null) {
    queue = await readQueue()
    if (queue) {
      const i = queue.jobs.findIndex((j) => j.queueId === next.queueId)
      if (i >= 0) {
        queue.jobs[i] = { ...queue.jobs[i], status: "failed", failReason: "Could not open application tab" }
        await writeQueue(queue)
      }
    }
    await advanceRun()
    return
  }
  armRunWatchdog(next.queueId)
}

async function handleQueueStartRun(): Promise<QueueActionResult> {
  const queue = await readQueue()
  if (!queue || queue.jobs.length === 0) return { type: "QUEUE_ACTION_RESULT", ok: false }
  queue.paused = false
  queue.runStatus = "running"
  queue.currentQueueId = null
  // A fresh run retries anything that previously failed.
  queue.jobs = queue.jobs.map((j) =>
    j.status === "failed" ? { ...j, status: "queued", failReason: null } : j,
  )
  await writeQueue(queue)
  void advanceRun()
  return { type: "QUEUE_ACTION_RESULT", ok: true }
}

async function handleQueueStopRun(): Promise<QueueActionResult> {
  clearRunWatchdog()
  // Stop driving the current tab but leave it open for the user.
  if (currentRunTabId !== null) {
    void deleteAgentTab(currentRunTabId)
    currentRunTabId = null
  }
  const queue = await readQueue()
  if (!queue) return { type: "QUEUE_ACTION_RESULT", ok: false }
  queue.runStatus = "idle"
  if (queue.currentQueueId) {
    const i = queue.jobs.findIndex((j) => j.queueId === queue.currentQueueId)
    if (i >= 0 && (queue.jobs[i].status === "applying" || queue.jobs[i].status === "waiting_login")) {
      queue.jobs[i] = { ...queue.jobs[i], status: "queued" }
    }
  }
  queue.currentQueueId = null
  await writeQueue(queue)
  return { type: "QUEUE_ACTION_RESULT", ok: true }
}

/** Single-job "Open & Fill": open one queued job in agent mode (fill + submit). */
async function handleQueueOpenJob(queueId: string): Promise<QueueActionResult> {
  const queue = await readQueue()
  if (!queue) return { type: "QUEUE_ACTION_RESULT", ok: false }
  const job = queue.jobs.find((j) => j.queueId === queueId)
  if (!job?.applyUrl) return { type: "QUEUE_ACTION_RESULT", ok: false }

  await setQueueItemStatus(queueId, "applying", { failReason: null })

  const tabId = await handleOperatorOpenTab(
    job.applyUrl,
    job.jobId ?? undefined,
    job.jobTitle,
    job.company ?? undefined,
    job.coverLetterId ?? undefined,
    true, // agentMode
  )
  if (tabId === null) {
    await setQueueItemStatus(queueId, "failed", { failReason: "Could not open application tab" })
    return { type: "QUEUE_ACTION_RESULT", ok: false }
  }
  manualAgentTabs.set(tabId, queueId)
  return { type: "QUEUE_ACTION_RESULT", ok: true }
}

async function handleAgentRunStatus(
  phase: "waiting_login" | "filling" | "failed",
  reason: string | undefined,
  senderTabId: number | undefined,
): Promise<import("./types").AgentRunStatusAck> {
  const reject = { type: "AGENT_RUN_STATUS_ACK", accepted: false } as const
  const accept = { type: "AGENT_RUN_STATUS_ACK", accepted: true } as const

  // A terminal failure ends this job — drop its agent context so the loops stop.
  if (phase === "failed" && senderTabId !== undefined) void deleteAgentTab(senderTabId)

  // Manual single-job "Open & Fill" (not a chained run): update just that job.
  if (senderTabId !== undefined && manualAgentTabs.has(senderTabId)) {
    const queueId = manualAgentTabs.get(senderTabId)!
    if (phase === "failed") {
      manualAgentTabs.delete(senderTabId)
      await setQueueItemStatus(queueId, "failed", {
        failReason: reason ?? "Agent could not complete this application",
      })
    } else {
      await setQueueItemStatus(queueId, phase === "waiting_login" ? "waiting_login" : "applying")
    }
    return accept
  }

  const queue = await readQueue()
  if (!queue || queue.runStatus !== "running" || !queue.currentQueueId) return reject
  if (senderTabId !== undefined && currentRunTabId !== null && senderTabId !== currentRunTabId) return reject

  if (phase === "failed") {
    await setQueueItemStatus(queue.currentQueueId, "failed", {
      failReason: reason ?? "Agent could not complete this application",
    })
    await advanceRun()
    return accept
  }

  await setQueueItemStatus(queue.currentQueueId, phase === "waiting_login" ? "waiting_login" : "applying")
  // Re-arm the watchdog so a login wait (or fresh page) doesn't trip the timeout.
  armRunWatchdog(queue.currentQueueId)
  return accept
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

// ── Apex MVP message channel ─────────────────────────────────────────────────
// Parallel to the typed BackgroundMessage channel above. Receives requests from
// the Apex Bar via api-client.ts and forwards them to the extension API,
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
  EXT_MVP_ANSWER_QUESTION: {
    method: "POST",
    path: "/api/autofill/answer-question",
    buildBody: (msg) => ({
      question: msg.question,
      jobTitle: msg.jobTitle,
      company:  msg.company,
    }),
  },
  EXT_MVP_MATCH_QUESTIONS: {
    method: "POST",
    path: "/api/extension/match-questions",
    buildBody: (msg) => ({
      jobTitle:  msg.jobTitle,
      company:   msg.company,
      questions: msg.questions,
    }),
  },
  EXT_MVP_TRACK_AUTOFILL: {
    method: "POST",
    path: "/api/extension/autofill/telemetry",
    buildBody: (msg) => msg.payload,
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
  resumeId?: string
  versionId?: string
  jobId?: string
}): Promise<
  { ok: true; data: { base64: string; filename: string } } | { ok: false; error: string }
> {
  const params = new URLSearchParams()
  if (opts?.versionId) params.set("versionId", opts.versionId)
  else if (opts?.resumeId) params.set("resumeId", opts.resumeId)
  else if (opts?.jobId) params.set("jobId", opts.jobId)
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
    if (!token) return { ok: false, error: "Sign in to Hireoven to use Apex." }

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
      const resumeId = typeof msg.resumeId === "string" ? msg.resumeId : undefined
      const versionId = typeof msg.versionId === "string" ? msg.versionId : undefined
      void fetchPrimaryResumeBytes({ jobId, resumeId, versionId }).then(sendResponse).catch((err: unknown) =>
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
          sendResponse({ ok: false, error: "Sign in to Hireoven to use Apex." })
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

// ── Shadow Network: scan LinkedIn connections at a company ────────────────────

/**
 * Runs the LinkedIn connection scan and PUSHES the result back to the Apex tab
 * rather than returning it through the original message port.
 *
 * Why: chrome.runtime.sendMessage ports in MV3 close after ~5s of service-worker
 * inactivity. The scan takes 15s, so the port is gone before we can respond.
 * Instead we fire-and-forget from the content script and push the result back
 * via chrome.tabs.sendMessage to the Apex tab when done.
 */
async function runScanAndPushResult(companyName: string): Promise<void> {
  const origin = await resolveOrigin()
  const searchUrl = buildLinkedInSearchUrl(companyName)

  async function pushToApexTabs(payload: { ok: boolean; connections?: ScannedConnection[]; error?: string }) {
    // Use broad localhost pattern (any port) so dev servers on :3001, :3002 etc. are found.
    const patterns = origin === PROD_APP_ORIGIN
      ? ["https://hireoven.com/*", "https://www.hireoven.com/*"]
      : ["http://localhost/*", "http://127.0.0.1/*"]
    for (const pattern of patterns) {
      const tabs = await chrome.tabs.query({ url: pattern }).catch(() => [])
      for (const tab of tabs) {
        if (!tab.id || !tab.url) continue
        // Skip non-Apex pages (e.g. LinkedIn which also runs on localhost in some setups)
        if (!isApexDashboardUrl(tab.url)) continue
        chrome.tabs.sendMessage(tab.id, { type: "PUSH_SCAN_RESULT", ...payload }).catch(() => {})
      }
    }
  }

  // Open active so LinkedIn fully renders — background tabs get JS throttled
  const tab = await chrome.tabs.create({ url: searchUrl, active: true })
  const tabId = tab.id
  if (!tabId) {
    await pushToApexTabs({ ok: false, error: "Could not open LinkedIn tab" })
    return
  }

  // Wait for page load (up to 15s)
  await new Promise<void>((resolve) => {
    const listener = (id: number, info: chrome.tabs.TabChangeInfo) => {
      if (id === tabId && info.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener)
        resolve()
      }
    }
    chrome.tabs.onUpdated.addListener(listener)
    setTimeout(resolve, 15_000)
  })

  // Switch back to the Apex tab immediately after load so the user isn't stuck on LinkedIn
  const apexPatterns = origin === PROD_APP_ORIGIN
    ? ["https://hireoven.com/*", "https://www.hireoven.com/*"]
    : ["http://localhost/*", "http://127.0.0.1/*"]
  for (const pattern of apexPatterns) {
    const apexTabs = await chrome.tabs.query({ url: pattern }).catch(() => [])
    const apex = apexTabs.find((t) => t.id && t.url && isApexDashboardUrl(t.url))
    if (apex?.id) {
      await chrome.tabs.update(apex.id, { active: true }).catch(() => {})
      break
    }
  }

  // Ask the LinkedIn tab's content script to scrape
  const scrapeResult = await new Promise<ScannedConnection[] | null>((resolve) => {
    chrome.tabs.sendMessage(
      tabId,
      { type: "SCRAPE_LINKEDIN_CONNECTIONS" },
      (response: unknown) => {
        if (chrome.runtime.lastError) {
          resolve(null); return
        }
        if (!response) {
          resolve(null); return
        }
        const conns = (response as any)?.connections ?? []
        resolve(conns)
      }
    )
    setTimeout(() => {
      resolve(null)
    }, 12_000)
  })

  await chrome.tabs.remove(tabId).catch(() => {})

  if (scrapeResult === null) {
    await pushToApexTabs({ ok: false, error: "Could not read LinkedIn. Make sure you are logged in." })
  } else {
    await pushToApexTabs({ ok: true, connections: scrapeResult })
  }
}

async function handleScanLinkedInConnections(
  companyName: string,
): Promise<ScanLinkedInConnectionsResult> {
  // Start scan asynchronously — result is pushed back to the Apex tab
  // so we don't block this message port (which would time out in MV3)
  void runScanAndPushResult(companyName)
  return { type: "SCAN_LINKEDIN_CONNECTIONS_RESULT", ok: true }
}

// ── Resume import: read the user's own LinkedIn profile ───────────────────────

/**
 * Opens the user's own LinkedIn profile (/in/me/ redirects to it under their
 * session), scrapes the rendered text, and PUSHES it back to the Apex tab via
 * PUSH_LINKEDIN_PROFILE_RESULT. Mirrors runScanAndPushResult — same MV3 port
 * constraint, so we fire-and-forget and push the result when done.
 */
/**
 * Sanitize a user-supplied LinkedIn profile URL. Returns a normalized
 * https://www.linkedin.com/in/<slug>/ URL, or null if it isn't a LinkedIn
 * profile URL. Critical: the URL arrives via a page postMessage, so we MUST
 * restrict what we'll open to linkedin.com /in/ paths only.
 */
function sanitizeLinkedInProfileUrl(raw?: string): string | null {
  if (!raw || typeof raw !== "string") return null
  try {
    let s = raw.trim()
    if (!/^https?:\/\//i.test(s)) s = `https://${s}`
    const u = new URL(s)
    if (!/(^|\.)linkedin\.com$/i.test(u.hostname)) return null
    if (!/^\/in\/[^/]+/i.test(u.pathname)) return null
    const cleanPath = u.pathname.replace(/\/+$/, "")
    return `https://www.linkedin.com${cleanPath}/`
  } catch {
    return null
  }
}

async function runImportAndPushResult(requestedUrl?: string): Promise<void> {
  const origin = await resolveOrigin()
  // Open the user-supplied profile when valid; otherwise the user's own (/in/me/).
  const profileUrl = sanitizeLinkedInProfileUrl(requestedUrl) ?? "https://www.linkedin.com/in/me/"

  async function pushToApexTabs(payload: { ok: boolean; rawText?: string; error?: string }) {
    const patterns = origin === PROD_APP_ORIGIN
      ? ["https://hireoven.com/*", "https://www.hireoven.com/*"]
      : ["http://localhost/*", "http://127.0.0.1/*"]
    for (const pattern of patterns) {
      const tabs = await chrome.tabs.query({ url: pattern }).catch(() => [])
      for (const tab of tabs) {
        if (!tab.id || !tab.url) continue
        if (!isApexDashboardUrl(tab.url)) continue
        chrome.tabs.sendMessage(tab.id, { type: "PUSH_LINKEDIN_PROFILE_RESULT", ...payload }).catch(() => {})
      }
    }
  }

  // Open active so LinkedIn fully renders (background tabs get JS-throttled).
  const tab = await chrome.tabs.create({ url: profileUrl, active: true })
  const tabId = tab.id
  if (!tabId) {
    await pushToApexTabs({ ok: false, error: "Could not open LinkedIn tab" })
    return
  }

  const waitForComplete = (id: number, timeoutMs = 15_000) =>
    new Promise<void>((resolve) => {
      const listener = (changedId: number, info: chrome.tabs.TabChangeInfo) => {
        if (changedId === id && info.status === "complete") {
          chrome.tabs.onUpdated.removeListener(listener)
          resolve()
        }
      }
      chrome.tabs.onUpdated.addListener(listener)
      setTimeout(resolve, timeoutMs)
    })

  const scrapeTab = (id: number) =>
    new Promise<string | null>((resolve) => {
      chrome.tabs.sendMessage(id, { type: "SCRAPE_LINKEDIN_PROFILE" }, (response: unknown) => {
        if (chrome.runtime.lastError || !response) {
          resolve(null); return
        }
        const text = (response as { rawText?: string })?.rawText ?? null
        resolve(typeof text === "string" ? text : null)
      })
      setTimeout(() => resolve(null), 14_000)
    })

  // Wait for page load (up to 15s).
  await waitForComplete(tabId)

  // If we got redirected to a login/authwall, the user isn't signed in.
  const loaded = await chrome.tabs.get(tabId).catch(() => null)
  if (loaded?.url && /\/(login|authwall|checkpoint)/i.test(loaded.url)) {
    await chrome.tabs.remove(tabId).catch(() => {})
    await pushToApexTabs({ ok: false, error: "Please log into LinkedIn, then try again." })
    return
  }

  // Scrape the main profile (headline, about, top skills, contact).
  const mainText = await scrapeTab(tabId)

  // The main profile TRUNCATES Experience/Education (shows ~2 then "Show all N").
  // Visit the dedicated detail pages to capture the COMPLETE lists. These are
  // SPA routes off the resolved profile URL.
  const base = (() => {
    try {
      const u = new URL(loaded?.url ?? profileUrl)
      const m = u.pathname.match(/^\/in\/[^/]+/i)
      return m ? `https://www.linkedin.com${m[0]}/` : null
    } catch {
      return null
    }
  })()

  const sections: string[] = []
  if (mainText) sections.push(mainText)

  if (base) {
    for (const [label, path] of [
      ["EXPERIENCE", "details/experience/"],
      ["EDUCATION", "details/education/"],
    ] as const) {
      try {
        await chrome.tabs.update(tabId, { url: `${base}${path}` }).catch(() => {})
        await waitForComplete(tabId, 12_000)
        const detail = await scrapeTab(tabId)
        if (detail && detail.trim().length > 0) {
          sections.push(`===== COMPLETE ${label} (authoritative — use these entries) =====\n${detail}`)
        }
      } catch {
        // best-effort per section
      }
    }
  }

  const rawText = sections.join("\n\n").trim() || mainText

  await chrome.tabs.remove(tabId).catch(() => {})

  // Return focus to the Apex tab.
  const apexPatterns = origin === PROD_APP_ORIGIN
    ? ["https://hireoven.com/*", "https://www.hireoven.com/*"]
    : ["http://localhost/*", "http://127.0.0.1/*"]
  for (const pattern of apexPatterns) {
    const apexTabs = await chrome.tabs.query({ url: pattern }).catch(() => [])
    const apex = apexTabs.find((t) => t.id && t.url && isApexDashboardUrl(t.url))
    if (apex?.id) {
      await chrome.tabs.update(apex.id, { active: true }).catch(() => {})
      break
    }
  }

  if (!rawText || rawText.trim().length < 80) {
    await pushToApexTabs({ ok: false, error: "Could not read your LinkedIn profile. Make sure you are logged in." })
  } else {
    await pushToApexTabs({ ok: true, rawText })
  }
}

async function handleImportLinkedInProfile(url?: string): Promise<ImportLinkedInProfileResult> {
  // Fire-and-forget — result is pushed back to the Apex tab (MV3 port timeout).
  void runImportAndPushResult(url)
  return { type: "IMPORT_LINKEDIN_PROFILE_RESULT", ok: true }
}
