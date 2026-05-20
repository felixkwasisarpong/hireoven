"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { ArrowRight } from "lucide-react"
import SessionStatusBadge from "@/components/interview/SessionStatusBadge"
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

const TYPE_LABELS: Record<string, string> = {
  text:   "Text",
  live:   "Live",
  coding: "Coding",
}

const TYPE_STYLES: Record<string, { pill: string; bar: string }> = {
  text:   { pill: "bg-blue-50 text-blue-700",   bar: "bg-blue-500" },
  live:   { pill: "bg-violet-50 text-violet-700", bar: "bg-violet-500" },
  coding: { pill: "bg-amber-50 text-amber-700",  bar: "bg-amber-500" },
}

const PERSONA_LABELS: Record<string, string> = {
  friendly_recruiter: "Friendly Recruiter",
  skeptical_hm:       "Skeptical HM",
  senior_staff:       "Senior Staff",
  founder:            "Founder",
  panel:              "Panel",
}

function scoreColor(score: number | null) {
  if (score === null) return "text-slate-400"
  if (score >= 80) return "text-emerald-600"
  if (score >= 60) return "text-amber-600"
  return "text-red-500"
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

export default function RecentSessionsList() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/interview/sessions?limit=5")
      .then((r) => r.json())
      .then((d) => setSessions(d.sessions ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <section className="mt-10">
        <div className="h-4 w-32 animate-pulse rounded bg-slate-100" />
        <div className="mt-3 space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-slate-100" />
          ))}
        </div>
      </section>
    )
  }

  if (sessions.length === 0) return null

  return (
    <section className="mt-10">
      <div className="flex items-center justify-between">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-slate-400">
          Recent sessions
        </h2>
        <Link
          href="/dashboard/interview/history"
          className="flex items-center gap-1 text-[12px] font-medium text-[#FF5C18] hover:text-orange-600"
        >
          View all <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      <div className="mt-3 space-y-2">
        {sessions.map((session) => {
          const style = TYPE_STYLES[session.type] ?? { pill: "bg-slate-100 text-slate-600", bar: "bg-slate-300" }
          const score = session.debrief?.overallScore ?? null
          const isCompleted = session.status === "completed" && session.debrief
          const isActive = session.status === "active"

          return (
            <div
              key={session.id}
              className="group flex items-center gap-3 overflow-hidden rounded-xl border border-slate-200 bg-white px-4 py-3 transition hover:border-slate-300 hover:shadow-sm"
            >
              {/* Mode color bar */}
              <div className={cn("h-8 w-1 flex-shrink-0 rounded-full", style.bar)} />

              {/* Type pill */}
              <span className={cn("hidden shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold sm:inline-flex", style.pill)}>
                {TYPE_LABELS[session.type] ?? session.type}
              </span>

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

              {/* Score */}
              {score !== null && (
                <div className="flex shrink-0 flex-col items-center">
                  <span className={cn("text-[18px] font-black tabular-nums leading-none", scoreColor(score))}>
                    {score}
                  </span>
                  <span className="text-[9px] font-medium uppercase tracking-wide text-slate-400">score</span>
                </div>
              )}

              {/* Status + action */}
              <div className="flex shrink-0 items-center gap-2">
                <SessionStatusBadge status={session.status} />
                {isCompleted ? (
                  <Link
                    href={`/dashboard/interview/${session.id}/debrief`}
                    className="flex items-center gap-1 text-[12px] font-medium text-[#FF5C18] hover:text-orange-600"
                  >
                    Debrief <ArrowRight className="h-3 w-3" />
                  </Link>
                ) : isActive ? (
                  <Link
                    href={`/dashboard/interview/${session.type}/${session.id}`}
                    className="flex items-center gap-1 text-[12px] font-medium text-blue-600 hover:text-blue-700"
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
