"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { CalendarClock, Video } from "lucide-react"
import {
  PERSONA_LABELS,
  countdownLabel,
  isJoinOpen,
  roleLabel,
} from "@/lib/interview/format"
import { cn } from "@/lib/utils"

type UpcomingSession = {
  id: string
  scheduledAt: string
  durationTargetMin: number
  persona: string
  jobTitle: string | null
  jobCompany: string | null
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

export default function UpcomingInterviews({ className }: { className?: string }) {
  const [sessions, setSessions] = useState<UpcomingSession[]>([])
  const [loaded, setLoaded] = useState(false)
  // Re-render every minute so countdowns and the join gate stay fresh.
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    fetch("/api/interview/schedule/upcoming")
      .then((r) => r.json())
      .then((d) => setSessions(d.sessions ?? []))
      .catch(() => {})
      .finally(() => setLoaded(true))

    const timer = setInterval(() => setNow(Date.now()), 60_000)
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
          const joinable = isJoinOpen(session.scheduledAt, now)
          return (
            <li
              key={session.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#eef1f5] bg-[#fbfcfd] px-4 py-3"
            >
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-[#0d1424]">
                  {formatWhen(session.scheduledAt)}
                  <span className="ml-2 rounded-full bg-[#f3eeff] px-2 py-0.5 text-[10.5px] font-semibold text-[#7c3aed]">
                    {countdownLabel(session.scheduledAt, now)}
                  </span>
                </p>
                <p className="mt-0.5 truncate text-[12px] text-[#5b6573]">
                  {roleLabel(session.jobTitle, session.jobCompany)} · {session.durationTargetMin}{" "}
                  min · {PERSONA_LABELS[session.persona] ?? session.persona}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {joinable ? (
                  <Link
                    href={`/dashboard/interview/live/${session.id}`}
                    target="_blank"
                    rel="noopener"
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
