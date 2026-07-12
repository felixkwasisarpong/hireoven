"use client"

import { useEffect } from "react"
import { publishLocalNotificationOnce } from "@/lib/hooks/useNotifications"
import { JOIN_GRACE_MINUTES, roleLabel } from "@/lib/interview/format"

// Invisible dashboard-wide watcher: polls the user's booked live interviews
// and raises in-app notifications as the start time approaches. Complements
// the push-notification cron — this covers the "user already has the app
// open" case with zero delivery lag.

type UpcomingSession = {
  id: string
  scheduledAt: string
  jobTitle: string | null
  jobCompany: string | null
}

const REFETCH_INTERVAL_MS = 5 * 60_000

function checkSessions(sessions: UpcomingSession[]) {
  const now = Date.now()
  for (const session of sessions) {
    const minutesLeft = (new Date(session.scheduledAt).getTime() - now) / 60_000
    if (minutesLeft < -JOIN_GRACE_MINUTES) continue

    const role = roleLabel(session.jobTitle, session.jobCompany, "your live mock interview")
    // scheduledAt is baked into the dedupe key so a reschedule re-arms
    // every tier for the new time.
    const keyBase = `interview-reminder-${session.id}-${session.scheduledAt}`

    if (minutesLeft <= 10) {
      publishLocalNotificationOnce({
        dedupeKey: `${keyBase}-soon`,
        cooldownMinutes: 24 * 60,
        type: "system",
        tone: "success",
        title: minutesLeft <= 0 ? "Your interview is starting now ⏰" : "Interview starting soon ⏰",
        message: `Time for ${role} — tap to join the room.`,
        href: `/dashboard/interview/live/${session.id}`,
      })
    } else if (minutesLeft <= 60) {
      publishLocalNotificationOnce({
        dedupeKey: `${keyBase}-hour`,
        cooldownMinutes: 24 * 60,
        type: "system",
        title: "Interview in about an hour",
        message: `${role} starts in ~${Math.round(minutesLeft)} min. Find a quiet spot and test your mic.`,
        href: `/dashboard/interview/scheduled/${session.id}`,
      })
    } else if (minutesLeft <= 24 * 60) {
      publishLocalNotificationOnce({
        dedupeKey: `${keyBase}-day`,
        cooldownMinutes: 7 * 24 * 60,
        type: "system",
        title: "Interview coming up 🎙️",
        message: `${role} is scheduled within the next day.`,
        href: `/dashboard/interview/scheduled/${session.id}`,
      })
    }
  }
}

export default function InterviewReminderWatcher() {
  useEffect(() => {
    let cancelled = false
    let checkTimer: ReturnType<typeof setInterval> | null = null

    function watch(sessions: UpcomingSession[]) {
      if (checkTimer) clearInterval(checkTimer)
      checkTimer = null
      if (sessions.length === 0) return // nothing booked — stay idle until refetch
      checkSessions(sessions)
      checkTimer = setInterval(() => checkSessions(sessions), 60_000)
    }

    async function refresh() {
      try {
        const res = await fetch("/api/interview/schedule/upcoming")
        if (!res.ok || cancelled) return
        const data = await res.json()
        if (!cancelled) watch(data.sessions ?? [])
      } catch {
        // transient — keep watching the last known list
      }
    }

    void refresh()
    const refetchTimer = setInterval(() => void refresh(), REFETCH_INTERVAL_MS)

    return () => {
      cancelled = true
      clearInterval(refetchTimer)
      if (checkTimer) clearInterval(checkTimer)
    }
  }, [])

  return null
}
