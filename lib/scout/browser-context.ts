"use client"

/**
 * Scout Active Browser Context — V1
 *
 * The extension content script running on hireoven.com relays lightweight
 * page-state from the background service worker via window.postMessage.
 *
 * Extension → Scout events (postMessage source: "hireoven-ext"):
 *   ACTIVE_CONTEXT_CHANGED — page context updated (tab switch, URL change)
 *   AUTOFILL_AVAILABLE     — active tab has an application form ready to fill
 *   JOB_RESOLVED           — active job now has a Hireoven job ID
 *   PAGE_MODE_CHANGED      — pageType changed (e.g. job_detail → application_form)
 *
 * Scout → Extension commands (postMessage source: "hireoven-scout"):
 *   GET_ACTIVE_CONTEXT     — request current context snapshot
 *   OPEN_AUTOFILL          — ask extension to open autofill drawer on active job tab
 *   START_TAILOR           — ask extension to open tailor drawer
 *   START_COMPARE          — hint to compare mode (informational)
 *   START_WORKFLOW         — hint to start a workflow on the active job
 */

import { useCallback, useEffect, useRef, useState } from "react"

// ── Types ─────────────────────────────────────────────────────────────────────

export type ActiveBrowserPageType =
  | "search_results"
  | "job_detail"
  | "application_form"
  | "company_page"
  | "unknown"

export type ActiveBrowserContext = {
  pageType: ActiveBrowserPageType
  /** ATS provider if detected on the active tab */
  atsProvider?: string
  /** Full URL of the active tab */
  url: string
  title?: string
  company?: string
  location?: string
  /** Hireoven job ID if already resolved in this session */
  detectedJobId?: string
  autofillAvailable?: boolean
  detectedFieldsCount?: number
  timestamp: number
}

export type ScoutExtensionCommand =
  | "GET_ACTIVE_CONTEXT"
  | "OPEN_AUTOFILL"
  | "START_TAILOR"
  | "START_COMPARE"
  | "START_WORKFLOW"
  // Browser Operator V1 — supervised actions dispatched by useScoutBrowserOperator
  | "OPERATOR_OPEN_TAB"
  | "OPERATOR_NAVIGATE"
  | "OPERATOR_FOCUS_FIELD"
  | "OPERATOR_SCROLL_TO"
  | "OPERATOR_HIGHLIGHT_FIELD"
  | "OPERATOR_INSERT_TEXT"
  | "OPERATOR_UPLOAD_RESUME"

// ── Protocol constants ────────────────────────────────────────────────────────

export const FROM_SCOUT = "hireoven-scout"
export const FROM_EXT   = "hireoven-ext"

const HANDLED_EXT_EVENTS = new Set([
  "ACTIVE_CONTEXT_CHANGED",
  "AUTOFILL_AVAILABLE",
  "JOB_RESOLVED",
  "PAGE_MODE_CHANGED",
  // Legacy names kept for backward compat during rollout
  "ACTIVE_CONTEXT_RESULT",
  "ACTIVE_CONTEXT_PUSH",
])

const DEBOUNCE_MS   = 500
const STALE_AFTER_MS = 90_000

// ── Hook ──────────────────────────────────────────────────────────────────────

export type BrowserContextState = {
  /** Current active browser context from the extension, or null if unavailable */
  context: ActiveBrowserContext | null
  /** True when at least one message from the extension has arrived this session */
  isExtensionConnected: boolean
}

export function useActiveBrowserContext(): BrowserContextState & {
  requestSync: () => void
} {
  const [state, setState] = useState<BrowserContextState>({
    context: null,
    isExtensionConnected: false,
  })

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const staleRef   = useRef<ReturnType<typeof setTimeout> | null>(null)

  const resetStaleTimer = useCallback(() => {
    if (staleRef.current) clearTimeout(staleRef.current)
    staleRef.current = setTimeout(() => {
      setState((prev) => ({ ...prev, context: null, isExtensionConnected: false }))
    }, STALE_AFTER_MS)
  }, [])

  const handleMessage = useCallback(
    (event: MessageEvent) => {
      if (typeof event.data !== "object" || event.data === null) return
      const msg = event.data as Record<string, unknown>
      if (msg.source !== FROM_EXT) return
      if (!HANDLED_EXT_EVENTS.has(msg.type as string)) return

      const ctx = (msg.context ?? null) as ActiveBrowserContext | null

      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        setState({ context: ctx, isExtensionConnected: true })
        resetStaleTimer()
      }, DEBOUNCE_MS)
    },
    [resetStaleTimer],
  )

  const requestSync = useCallback(() => {
    if (typeof window === "undefined") return
    window.postMessage(
      { source: FROM_SCOUT, type: "GET_ACTIVE_CONTEXT" },
      window.location.origin,
    )
  }, [])

  useEffect(() => {
    window.addEventListener("message", handleMessage)
    requestSync()
    return () => {
      window.removeEventListener("message", handleMessage)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      if (staleRef.current) clearTimeout(staleRef.current)
    }
  }, [handleMessage, requestSync])

  return { ...state, requestSync }
}

// ── Scout → Extension command sender ─────────────────────────────────────────

/**
 * Posts a command to the extension via the hireoven.com content script bridge.
 * The content script relays it to the background service worker, which forwards
 * it to the most recently active job site tab.
 *
 * Commands are informational — they may open UI in the extension but never
 * perform autonomous actions (no auto-submit, no silent autofill).
 */
export function sendExtensionCommand(
  command: ScoutExtensionCommand,
  payload?: Record<string, unknown>,
): void {
  if (typeof window === "undefined") return
  window.postMessage(
    { source: FROM_SCOUT, type: command, ...payload },
    window.location.origin,
  )
}
