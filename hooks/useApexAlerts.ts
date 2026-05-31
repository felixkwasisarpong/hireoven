"use client"

import { useEffect, useRef, useState, useCallback } from "react"

export type ApexAlert = {
  type: "new_match" | "top_drop"
  jobId: string
  title: string
  company: string | null
  matchScore: number | null
  location: string | null
  isRemote: boolean
  alertedAt: string
}

type Options = {
  /** Called when a new alert arrives */
  onAlert?: (alert: ApexAlert) => void
  /** Skip connecting (e.g. user is not Pro) */
  disabled?: boolean
}

/**
 * Subscribes to the Apex real-time job alerts SSE stream.
 * Returns the latest alert and a manual dismiss handler.
 */
export function useApexAlerts({ onAlert, disabled = false }: Options = {}) {
  const [latest, setLatest] = useState<ApexAlert | null>(null)
  const [connected, setConnected] = useState(false)
  const esRef = useRef<EventSource | null>(null)

  const dismiss = useCallback(() => setLatest(null), [])

  useEffect(() => {
    if (disabled) return

    let retryTimer: ReturnType<typeof setTimeout>
    let attempts = 0

    function connect() {
      const es = new EventSource("/api/apex/alerts")
      esRef.current = es

      es.onopen = () => {
        setConnected(true)
        attempts = 0
      }

      function handleAlert(event: MessageEvent) {
        try {
          const alert = JSON.parse(event.data) as ApexAlert
          setLatest(alert)
          onAlert?.(alert)
          // Browser notification if permission granted
          if (Notification.permission === "granted") {
            new Notification(`Apex — ${alert.type === "top_drop" ? "Top match!" : "New match"}: ${alert.matchScore}%`, {
              body: `${alert.title} at ${alert.company ?? "Unknown"}`,
              icon: "/favicon.ico",
              tag: `apex-alert-${alert.jobId}`,
            })
          }
        } catch { /* ignore malformed events */ }
      }

      es.addEventListener("new_match", handleAlert)
      es.addEventListener("top_drop", handleAlert)

      es.onerror = () => {
        setConnected(false)
        es.close()
        // Exponential back-off: 2s, 4s, 8s … capped at 60s
        const delay = Math.min(2000 * 2 ** attempts, 60_000)
        attempts++
        retryTimer = setTimeout(connect, delay)
      }
    }

    connect()

    return () => {
      clearTimeout(retryTimer)
      esRef.current?.close()
      setConnected(false)
    }
  }, [disabled, onAlert])

  return { latest, connected, dismiss }
}
