/**
 * Scout Observer — lightweight structured observability.
 *
 * Captures Scout-specific error events without logging sensitive values.
 * Writes to:
 *   - console.error (dev only, or on explicit errors)
 *   - sessionStorage ring buffer (last 30 events, cleared on tab close)
 *
 * Privacy contract:
 *   NEVER log: form values, resume text, cover letter content,
 *              application answers, auth tokens, PII
 *   ALWAYS safe: event type, error message (truncated), component name, mode
 *
 * Future: swap the sessionStorage sink for a proper APM endpoint.
 */

const STORE_KEY  = "hireoven:scout:observer:v1"
const MAX_EVENTS = 30

// ── Event types ───────────────────────────────────────────────────────────────

export type ScoutObserverEventType =
  | "render_error"          // React error boundary caught a crash
  | "command_failure"       // Scout chat returned an error
  | "directive_failure"     // workspace_directive failed to apply
  | "parse_failure"         // JSON parse failed on Scout response
  | "permission_denial"     // Scout action blocked by permission check
  | "extension_failure"     // extension bridge dispatch failed
  | "workflow_failure"      // workflow step failed
  | "autofill_failure"      // autofill dispatch or field fill failed
  | "research_failure"      // research engine error
  | "career_engine_failure" // career strategy engine error
  | "operator_failure"      // browser operator dispatch error
  | "sse_error"             // SSE stream error
  | "timeout"               // request/step exceeded time limit

export type ScoutObserverEvent = {
  type:       ScoutObserverEventType
  message:    string
  metadata?:  Record<string, unknown>
  timestamp?: number
}

type StoredEvent = ScoutObserverEvent & { timestamp: number }

const IS_DEV = process.env.NODE_ENV === "development"

// ── Ring buffer ───────────────────────────────────────────────────────────────

function readBuffer(): StoredEvent[] {
  if (typeof window === "undefined") return []
  try {
    const raw = sessionStorage.getItem(STORE_KEY)
    return raw ? (JSON.parse(raw) as StoredEvent[]) : []
  } catch { return [] }
}

function writeBuffer(events: StoredEvent[]): void {
  if (typeof window === "undefined") return
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(events.slice(0, MAX_EVENTS)))
  } catch {}
}

// ── Public observer ───────────────────────────────────────────────────────────

export const scoutObserver = {
  /**
   * Record one Scout event. Never throws.
   * Safe metadata only — never pass form values or user content.
   */
  capture(event: ScoutObserverEvent): void {
    try {
      const stored: StoredEvent = { ...event, timestamp: Date.now() }

      // Console — always log errors to console.error regardless of env
      if (IS_DEV || event.type === "render_error" || event.type === "command_failure") {
        console.error(`[scout:observer] ${event.type}`, event.message, event.metadata ?? "")
      }

      const buf = readBuffer()
      buf.unshift(stored)
      writeBuffer(buf)
    } catch {
      // Observer itself must never throw
    }
  },

  /** Convenience wrapper for caught Error objects. */
  captureError(
    type:      ScoutObserverEventType,
    error:     unknown,
    metadata?: Record<string, unknown>,
  ): void {
    const message =
      error instanceof Error
        ? error.message.slice(0, 200)
        : typeof error === "string"
        ? error.slice(0, 200)
        : "Unknown error"

    this.capture({ type, message, metadata })
  },

  /** Read the current event buffer (for debug panels in dev). */
  readLog(): StoredEvent[] {
    return readBuffer()
  },

  /** Clear the buffer (e.g. when user starts a fresh session). */
  clearLog(): void {
    if (typeof window === "undefined") return
    try { sessionStorage.removeItem(STORE_KEY) } catch {}
  },
}
