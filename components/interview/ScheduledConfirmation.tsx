"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { CalendarPlus, CheckCircle2, Download, Video, X } from "lucide-react"
import SchedulePicker from "@/components/interview/SchedulePicker"
import { useToast } from "@/components/ui/ToastProvider"
import {
  JOIN_OPENS_MINUTES,
  buildGoogleCalendarUrl,
  countdownLabel,
  isJoinOpen,
  roleLabel,
} from "@/lib/interview/format"
import { cn } from "@/lib/utils"

type ScheduledConfirmationProps = {
  sessionId: string
  scheduledAt: string
  durationMin: number
  personaLabel: string
  jobTitle: string | null
  jobCompany: string | null
  /** Absolute origin for calendar links (server-resolved, avoids hydration drift). */
  appOrigin: string
}

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  })
}

export default function ScheduledConfirmation({
  sessionId,
  scheduledAt: initialScheduledAt,
  durationMin,
  personaLabel,
  jobTitle,
  jobCompany,
  appOrigin,
}: ScheduledConfirmationProps) {
  const router = useRouter()
  const { pushToast } = useToast()

  const [scheduledAt, setScheduledAt] = useState(initialScheduledAt)
  const [rescheduling, setRescheduling] = useState(false)
  const [newSlot, setNewSlot] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Ticks so the join gate unlocks while the page stays open.
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])

  const joinable = isJoinOpen(scheduledAt, now)
  const icsUrl = `/api/interview/sessions/${sessionId}/calendar.ics`
  // Built client-side from the CURRENT time so a reschedule updates the link.
  const googleCalendarUrl = useMemo(
    () =>
      buildGoogleCalendarUrl({
        scheduledAt: new Date(scheduledAt),
        durationMin,
        joinUrl: `${appOrigin}/dashboard/interview/live/${sessionId}`,
        jobTitle,
        jobCompany,
      }),
    [scheduledAt, durationMin, appOrigin, sessionId, jobTitle, jobCompany]
  )

  async function confirmReschedule() {
    if (!newSlot) {
      pushToast({ tone: "error", title: "Pick a new time slot first" })
      return
    }
    setBusy(true)
    try {
      const res = await fetch(`/api/interview/sessions/${sessionId}/schedule`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scheduledAt: newSlot,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        pushToast({ tone: "error", title: data.error ?? "Failed to reschedule" })
        return
      }
      setScheduledAt(data.scheduledAt)
      setRescheduling(false)
      setNewSlot(null)
      pushToast({ tone: "success", title: "Interview rescheduled" })
    } catch {
      pushToast({ tone: "error", title: "Network error — please try again" })
    } finally {
      setBusy(false)
    }
  }

  async function cancelBooking() {
    if (!window.confirm("Cancel this scheduled interview?")) return
    setBusy(true)
    try {
      const res = await fetch(`/api/interview/sessions/${sessionId}/schedule`, {
        method: "DELETE",
      })
      const data = await res.json()
      if (!res.ok) {
        pushToast({ tone: "error", title: data.error ?? "Failed to cancel" })
        return
      }
      pushToast({ tone: "success", title: "Interview cancelled" })
      router.push("/dashboard/interview")
    } catch {
      pushToast({ tone: "error", title: "Network error — please try again" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <Link
        href="/dashboard/interview"
        className="text-[13px] font-medium text-slate-500 hover:text-slate-700"
      >
        ← Back to interview hub
      </Link>

      <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 h-7 w-7 shrink-0 text-emerald-500" aria-hidden />
          <div>
            <h1 className="text-xl font-bold text-slate-900">You&apos;re booked!</h1>
            <p className="mt-1 text-[13px] text-slate-500">
              We emailed you a confirmation. You&apos;ll get reminders here in the app as the
              time gets close.
            </p>
          </div>
        </div>

        <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-5">
          <p className="text-[15px] font-bold text-slate-900">{formatWhen(scheduledAt)}</p>
          <p className="mt-1 text-[13px] text-slate-600">
            Starts {countdownLabel(scheduledAt, now)} · {durationMin} min live session · {personaLabel}
          </p>
          <p className="mt-0.5 text-[13px] text-slate-500">{roleLabel(jobTitle, jobCompany)}</p>
        </div>

        {/* Add to calendar */}
        <div className="mt-5 flex flex-wrap gap-2">
          <a
            href={googleCalendarUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2.5 text-[13px] font-semibold text-white transition hover:bg-orange-600"
          >
            <CalendarPlus className="h-4 w-4" aria-hidden />
            Add to Google Calendar
          </a>
          <a
            href={icsUrl}
            className="inline-flex items-center gap-2 rounded-lg border border-orange-300 px-4 py-2.5 text-[13px] font-semibold text-orange-600 transition hover:bg-orange-50"
          >
            <Download className="h-4 w-4" aria-hidden />
            Download .ics
          </a>
          <Link
            href={`/dashboard/interview/live/${sessionId}`}
            target="_blank"
            rel="noopener"
            aria-disabled={!joinable}
            className={cn(
              "inline-flex items-center gap-2 rounded-lg border px-4 py-2.5 text-[13px] font-semibold transition",
              joinable
                ? "border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                : "pointer-events-none border-slate-200 text-slate-400"
            )}
          >
            <Video className="h-4 w-4" aria-hidden />
            {joinable ? "Join now" : `Join opens ${JOIN_OPENS_MINUTES} min before`}
          </Link>
        </div>

        {/* Reschedule / cancel */}
        <div className="mt-6 border-t border-slate-100 pt-4">
          {!rescheduling ? (
            <div className="flex gap-4 text-[13px] font-medium">
              <button
                type="button"
                onClick={() => setRescheduling(true)}
                className="text-slate-600 hover:text-slate-900"
              >
                Reschedule
              </button>
              <button
                type="button"
                onClick={cancelBooking}
                disabled={busy}
                className="text-red-500 hover:text-red-700 disabled:opacity-60"
              >
                Cancel booking
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[13px] font-semibold text-slate-700">Pick a new time</p>
                <button
                  type="button"
                  onClick={() => {
                    setRescheduling(false)
                    setNewSlot(null)
                  }}
                  className="rounded p-1 text-slate-400 hover:text-slate-600"
                  aria-label="Close reschedule"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <SchedulePicker durationMin={durationMin} value={newSlot} onChange={setNewSlot} />
              <button
                type="button"
                onClick={confirmReschedule}
                disabled={busy || !newSlot}
                className="rounded-lg bg-orange-500 px-4 py-2.5 text-[13px] font-semibold text-white transition hover:bg-orange-600 disabled:opacity-60"
              >
                {busy ? "Rescheduling…" : "Confirm new time"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
