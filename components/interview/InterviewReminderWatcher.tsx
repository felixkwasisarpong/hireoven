"use client"

import { useEffect } from "react"
import { publishLocalNotificationOnce } from "@/lib/hooks/useNotifications"

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

const POLL_INTERVAL_MS = 60_000
const JOIN_GRACE_MINUTES = 30

function roleLabel(session: UpcomingSession) {
  return session.jobTitle
    ? `${session.jobTitle}${session.jobCompany ? ` @ ${session.jobCompany}` : ""}`
    : "your live mock interview"
}

function checkSessions(sessions: UpcomingSession[]) {
  const now = Date.now()
  for (const session of sessions) {
    const minutesLeft = (new Date(session.scheduledAt).getTime() - now) / 60_000
    if (minutesLeft < -JOIN_GRACE_MINUTES) continue

    if (minutesLeft <= 10) {
      publishLocalNotificationOnce({
        dedupeKey: `interview-reminder-${session.id}-soon`,
        cooldownMinutes: 24 * 60,
        type: "system",
        tone: "success",
        title: minutesLeft <= 0 ? "Your interview is starting now ⏰" : "Interview starting soon ⏰",
        message: `Time for ${roleLabel(session)} — tap to join the room.`,
        href: `/dashboard/interview/live/${session.id}`,
      })
    } else if (minutesLeft <= 60) {
      publishLocalNotificationOnce({
        dedupeKey: `interview-reminder-${session.id}-hour`,
        cooldownMinutes: 24 * 60,
        type: "system",
        title: "Interview in about an hour",
        message: `${roleLabel(session)} starts in ~${Math.round(minutesLeft)} min. Find a quiet spot and test your mic.`,
        href: `/dashboard/interview/scheduled/${session.id}`,
      })
    } else if (minutesLeft <= 24 * 60) {
      publishLocalNotificationOnce({
        dedupeKey: `interview-reminder-${session.id}-day`,
        cooldownMinutes: 7 * 24 * 60,
        type: "system",
        title: "Interview coming up 🎙️",
        message: `${roleLabel(session)} is scheduled within the next day.`,
        href: `/dashboard/interview/scheduled/${session.id}`,
      })
    }
  }
}

export default function InterviewReminderWatcher() {
  useEffect(() => {
    let sessions: UpcomingSession[] = []
    let cancelled = false

    async function refresh() {
      try {
        const res = await fetch("/api/interview/schedule/upcoming")
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled) sessions = data.sessions ?? []
      } catch {
        // transient — keep the last known list
      }
    }

    void refresh().then(() => {
      if (!cancelled) checkSessions(sessions)
    })

    // Re-check every minute; refetch the list every five.
    let ticks = 0
    const timer = setInterval(() => {
      ticks += 1
      if (ticks % 5 === 0) void refresh()
      checkSessions(sessions)
    }, POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  return null
}
