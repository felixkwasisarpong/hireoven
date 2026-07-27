"use client"

import { useEffect, useRef } from "react"

/**
 * Session-quality beacon. Posts one summary per dashboard visit to
 * /api/apex/session-quality (a fully-built endpoint that previously had zero
 * callers, so user_session_quality was never populated). This powers the
 * bounce/returning-user signals, the burnout classifier, and the admin growth
 * dashboard's session metrics.
 *
 * Privacy: no PII — just this user's own session duration + coarse action counts.
 * Components can dispatch window events to enrich the counts:
 *   window.dispatchEvent(new Event("hireoven:search"))  // a search performed
 *   window.dispatchEvent(new Event("hireoven:apply"))   // an apply attempt
 *   window.dispatchEvent(new Event("hireoven:save"))    // a job saved
 */

function randomId(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID()
  } catch {
    // fall through
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export default function SessionQualityTracker() {
  const start = useRef(Date.now())
  const sessionId = useRef(randomId())
  const actions = useRef(0)
  const counters = useRef({ applyAttempts: 0, savedJobs: 0, searchQueries: 0, modeChanges: 0 })
  const sent = useRef(false)

  useEffect(() => {
    const onClick = () => {
      actions.current = Math.min(actions.current + 1, 2000)
    }
    const onSearch = () => {
      counters.current.searchQueries += 1
      actions.current += 1
    }
    const onApply = () => {
      counters.current.applyAttempts += 1
      actions.current += 1
    }
    const onSave = () => {
      counters.current.savedJobs += 1
      actions.current += 1
    }

    const send = () => {
      if (sent.current) return
      sent.current = true
      const durationSeconds = Math.max(0, Math.round((Date.now() - start.current) / 1000))
      const payload = JSON.stringify({
        sessionId: sessionId.current,
        durationSeconds,
        actionsCount: actions.current,
        applyAttempts: counters.current.applyAttempts,
        savedJobs: counters.current.savedJobs,
        searchQueries: counters.current.searchQueries,
        modeChanges: counters.current.modeChanges,
      })
      try {
        if (typeof navigator !== "undefined" && navigator.sendBeacon) {
          navigator.sendBeacon("/api/apex/session-quality", new Blob([payload], { type: "application/json" }))
        } else {
          void fetch("/api/apex/session-quality", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: payload,
            keepalive: true,
          })
        }
      } catch {
        // best-effort
      }
    }

    const onVisibility = () => {
      if (document.visibilityState === "hidden") send()
    }

    document.addEventListener("click", onClick, true)
    window.addEventListener("hireoven:search", onSearch)
    window.addEventListener("hireoven:apply", onApply)
    window.addEventListener("hireoven:save", onSave)
    document.addEventListener("visibilitychange", onVisibility)
    window.addEventListener("pagehide", send)

    return () => {
      document.removeEventListener("click", onClick, true)
      window.removeEventListener("hireoven:search", onSearch)
      window.removeEventListener("hireoven:apply", onApply)
      window.removeEventListener("hireoven:save", onSave)
      document.removeEventListener("visibilitychange", onVisibility)
      window.removeEventListener("pagehide", send)
      // Leaving the dashboard (SPA unmount) — capture the session if not already.
      send()
    }
  }, [])

  return null
}
