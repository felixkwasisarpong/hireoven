"use client"

/**
 * Scout Active Browser Context — V1
 *
 * The extension content script running on hireoven.com relays lightweight
 * page-state from the background service worker via window.postMessage.
 *
 * This hook listens for those messages and exposes current browser context
 * to Scout UI components for adaptive behavior (placeholder, chips, rail).
 *
 * Communication protocol:
 *   Page → Extension:   window.postMessage({ source: "hireoven-scout", type: "GET_ACTIVE_CONTEXT" })
 *   Extension → Page:   window.postMessage({ source: "hireoven-ext",   type: "ACTIVE_CONTEXT_RESULT" | "ACTIVE_CONTEXT_PUSH", context })
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

// ── Protocol markers ──────────────────────────────────────────────────────────

const FROM_SCOUT = "hireoven-scout"
const FROM_EXT = "hireoven-ext"
const DEBOUNCE_MS = 500
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

      const type = msg.type as string
      if (type !== "ACTIVE_CONTEXT_RESULT" && type !== "ACTIVE_CONTEXT_PUSH") return

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
