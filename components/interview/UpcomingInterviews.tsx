"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { CalendarClock, Video } from "lucide-react"
import { cn } from "@/lib/utils"

type UpcomingSession = {
  id: string
  scheduledAt: string
  durationTargetMin: number
  persona: string
  jobTitle: string | null
  jobCompany: string | null
}

const JOIN_OPENS_MINUTES = 10

const PERSONA_LABELS: Record<string, string> = {
  friendly_recruiter: "Recruiter",
  skeptical_hm: "Skeptical HM",
  senior_staff: "Senior Peer",
  founder: "Founder",
  panel: "Panel",
}

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

function countdownLabel(iso: string) {
  const diffMin = Math.round((new Date(iso).getTime() - Date.now()) / 60_000)
  if (diffMin <= 0) return "now"
  if (diffMin < 60) return `in ${diffMin}m`
  if (diffMin < 24 * 60) return `in ${Math.round(diffMin / 60)}h`
  return `in ${Math.round(diffMin / (60 * 24))}d`
}

export default function UpcomingInterviews({ className }: { className?: string }) {
  const [sessions, setSessions] = useState<UpcomingSession[]>([])
  const [loaded, setLoaded] = useState(false)
  // Re-render every minute so countdowns and the join gate stay fresh.
  const [, setTick] = useState(0)

  useEffect(() => {
    fetch("/api/interview/schedule/upcoming")
      .then((r) => r.json())
      .then((d) => setSessions(d.sessions ?? []))
      .catch(() => {})
      .finally(() => setLoaded(true))

    const timer = setInterval(() => setTick((t) => t + 1), 60_000)
    return () => clearInterval(timer)
  }, [])

  if (!loaded || sessions.length === 0) return null

  return (
    <section
      className={cn(
        "rounded-2xl border border-[#e7eaf0] bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,.03)] lg:p-5",
        className
      )}
    >
      <div className="mb-3 flex items-center gap-2">
        <CalendarClock className="h-4 w-4 text-[#ec6516]" strokeWidth={2} aria-hidden />
        <h2 className="text-[14px] font-bold text-[#0d1424]">Upcoming interviews</h2>
      </div>

      <ul className="space-y-2">
        {sessions.map((session) => {
          const joinable =
            Date.now() >= new Date(session.scheduledAt).getTime() - JOIN_OPENS_MINUTES * 60_000
          return (
            <li
              key={session.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#eef1f5] bg-[#fbfcfd] px-4 py-3"
            >
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-[#0d1424]">
                  {formatWhen(session.scheduledAt)}
                  <span className="ml-2 rounded-full bg-[#f3eeff] px-2 py-0.5 text-[10.5px] font-semibold text-[#7c3aed]">
                    {countdownLabel(session.scheduledAt)}
                  </span>
                </p>
                <p className="mt-0.5 truncate text-[12px] text-[#5b6573]">
                  {session.jobTitle
                    ? `${session.jobTitle}${session.jobCompany ? ` @ ${session.jobCompany}` : ""}`
                    : "General practice"}{" "}
                  · {session.durationTargetMin} min ·{" "}
                  {PERSONA_LABELS[session.persona] ?? session.persona}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {joinable ? (
                  <Link
                    href={`/dashboard/interview/live/${session.id}`}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-[12.5px] font-semibold text-white transition hover:bg-emerald-600"
                  >
                    <Video className="h-3.5 w-3.5" aria-hidden />
                    Join now
                  </Link>
                ) : (
                  <Link
                    href={`/dashboard/interview/scheduled/${session.id}`}
                    className="rounded-lg border border-[#e7eaf0] bg-white px-3 py-1.5 text-[12.5px] font-semibold text-[#3f4856] transition hover:border-[#d6dbe4]"
                  >
                    Manage
                  </Link>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
