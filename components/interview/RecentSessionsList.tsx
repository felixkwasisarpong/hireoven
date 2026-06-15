"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { cn } from "@/lib/utils"

type Session = {
  id: string
  type: string
  persona: string
  status: string
  jobTitle: string | null
  jobCompany: string | null
  createdAt: string
  debrief: { overallScore: number | null } | null
}

type RecentSessionsListProps = {
  initialSessions?: Session[]
  initialLoaded?: boolean
  className?: string
}

const TYPE_LABELS: Record<string, string> = {
  text:   "Text",
  live:   "Live",
  coding: "Coding",
}

const TYPE_STYLES: Record<string, { pill: string; dot: string }> = {
  text:   { pill: "bg-blue-50 text-blue-700 ring-1 ring-blue-100",    dot: "bg-blue-500" },
  live:   { pill: "bg-violet-50 text-violet-700 ring-1 ring-violet-100", dot: "bg-violet-500" },
  coding: { pill: "bg-amber-50 text-amber-700 ring-1 ring-amber-100",  dot: "bg-amber-500" },
}

const PERSONA_LABELS: Record<string, string> = {
  friendly_recruiter: "Recruiter",
  skeptical_hm:       "Skeptical HM",
  senior_staff:       "Senior Peer",
  founder:            "Founder",
  panel:              "Panel",
}

function scoreColor(score: number | null) {
  if (score === null) return "text-slate-400"
  if (score >= 80) return "text-emerald-600"
  if (score >= 60) return "text-amber-600"
  return "text-red-500"
}

function scoreBg(score: number | null) {
  if (score === null) return "bg-slate-50 ring-slate-200"
  if (score >= 80) return "bg-emerald-50 ring-emerald-200"
  if (score >= 60) return "bg-amber-50 ring-amber-200"
  return "bg-red-50 ring-red-200"
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

export default function RecentSessionsList({
  initialSessions = [],
  initialLoaded = false,
  className,
}: RecentSessionsListProps) {
  const [sessions, setSessions] = useState<Session[]>(initialSessions)
  const [loading, setLoading] = useState(!initialLoaded)

  useEffect(() => {
    if (initialLoaded) return

    fetch("/api/interview/sessions?limit=5")
      .then((r) => r.json())
      .then((d) => setSessions(d.sessions ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [initialLoaded])

  if (loading) {
    return (
      <section className={cn("rounded-lg border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]", className)}>
        <div className="h-4 w-32 animate-pulse rounded-full bg-slate-100" />
        <div className="mt-3 space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[60px] animate-pulse rounded-lg bg-slate-100" />
          ))}
        </div>
      </section>
    )
  }

  if (sessions.length === 0) return null

  return (
    <section className={cn("rounded-lg border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]", className)}>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
            Recent sessions
          </p>
          <h2 className="mt-1 text-sm font-semibold text-slate-950">Debriefs and active rooms</h2>
        </div>
        <Link
          href="/dashboard/interview/history"
          className="flex items-center gap-1 text-[12px] font-medium text-slate-500 transition hover:text-slate-600"
        >
          View all <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      <div className="space-y-2">
        {sessions.map((session) => {
          const style = TYPE_STYLES[session.type] ?? { pill: "bg-slate-50 text-slate-600 ring-1 ring-slate-200", dot: "bg-slate-300" }
          const score = session.debrief?.overallScore ?? null
          const isCompleted = session.status === "completed" && session.debrief
          const isActive = session.status === "active"

          return (
            <div
              key={session.id}
              className="group flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-3 transition hover:border-slate-300 hover:bg-slate-50"
            >
              {/* Type pill */}
              <span className={cn("hidden shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold sm:inline-flex", style.pill)}>
                {TYPE_LABELS[session.type] ?? session.type}
              </span>

              {/* Mobile dot */}
              <span className={cn("h-2 w-2 shrink-0 rounded-full sm:hidden", style.dot)} />

              {/* Title + meta */}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold text-slate-900">
                  {session.jobTitle
                    ? `${session.jobTitle}${session.jobCompany ? ` · ${session.jobCompany}` : ""}`
                    : "Generic practice"}
                </p>
                <p className="text-[11px] text-slate-400">
                  {PERSONA_LABELS[session.persona] ?? session.persona} · {formatDate(session.createdAt)}
                </p>
              </div>

              {/* Score badge */}
              {score !== null && (
                <div className={cn(
                  "flex shrink-0 items-center justify-center rounded-lg px-2 py-1 ring-1",
                  scoreBg(score)
                )}>
                  <span className={cn("text-[14px] font-black tabular-nums leading-none", scoreColor(score))}>
                    {score}
                  </span>
                </div>
              )}

              {/* Action link */}
              <div className="flex shrink-0 items-center">
                {isCompleted ? (
                  <Link
                    href={`/dashboard/interview/${session.id}/debrief`}
                    className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-100"
                  >
                    Debrief <ArrowRight className="h-3 w-3" />
                  </Link>
                ) : isActive ? (
                  <Link
                    href={`/dashboard/interview/${session.type}/${session.id}`}
                    className="flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-600 transition hover:bg-blue-100"
                  >
                    Resume <ArrowRight className="h-3 w-3" />
                  </Link>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
