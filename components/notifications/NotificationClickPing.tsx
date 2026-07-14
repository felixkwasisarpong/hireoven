"use client"

import { useEffect } from "react"

/**
 * Fire-and-forget click attribution for notification referrals. Mounted on the
 * job detail page when the URL carries ?ntf=1 (alert email links, push taps) —
 * stamps alert_notifications.clicked_at for this (user, job) so the admin
 * alerts log can report real click rates. Renders nothing.
 */
export default function NotificationClickPing({ jobId }: { jobId: string }) {
  useEffect(() => {
    const key = `ntf-click:${jobId}`
    try {
      if (sessionStorage.getItem(key)) return
      sessionStorage.setItem(key, "1")
    } catch {
      // storage unavailable (private mode) — ping anyway, the server COALESCEs
    }
    void fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId, clicked: true }),
      keepalive: true,
    }).catch(() => {})
  }, [jobId])

  return null
}
