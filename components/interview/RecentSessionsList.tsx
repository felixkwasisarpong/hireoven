"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import SessionStatusBadge from "@/components/interview/SessionStatusBadge"
import ScoreBadge from "@/components/interview/ScoreBadge"
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
  text: "Text",
  live: "Live",
  coding: "Coding",
}

const TYPE_COLORS: Record<string, string> = {
  text: "bg-blue-50 text-blue-700",
  live: "bg-purple-50 text-purple-700",
  coding: "bg-amber-50 text-amber-700",
}

const PERSONA_LABELS: Record<string, string> = {
  friendly_recruiter: "Friendly Recruiter",
  skeptical_hm: "Skeptical HM",
  senior_staff: "Senior Staff",
  founder: "Founder",
  panel: "Panel",
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
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
      <section className="mt-8">
        <div className="h-4 w-32 animate-pulse rounded bg-slate-100" />
        <div className="mt-3 space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-lg bg-slate-100" />
          ))}
        </div>
      </section>
    )
  }

  if (sessions.length === 0) return null

  return (
    <section className="mt-8">
      <div className="flex items-center justify-between">
        <h2 className="text-[14px] font-semibold text-slate-700">Recent sessions</h2>
        <Link href="/dashboard/interview/history" className="text-[12px] font-medium text-orange-500 hover:text-orange-600">
          View all
        </Link>
      </div>

      <div className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
        {sessions.map((session) => (
          <div key={session.id} className="flex items-center gap-3 px-4 py-3">
            <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", TYPE_COLORS[session.type] ?? "bg-slate-100 text-slate-600")}>
              {TYPE_LABELS[session.type] ?? session.type}
            </span>

            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-slate-900">
                {session.jobTitle
                  ? `${session.jobTitle}${session.jobCompany ? ` @ ${session.jobCompany}` : ""}`
                  : "Generic"}
              </p>
              <p className="text-[11px] text-slate-400">
                {PERSONA_LABELS[session.persona] ?? session.persona} · {formatDate(session.createdAt)}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {session.debrief ? (
                <ScoreBadge score={session.debrief.overallScore} />
              ) : null}
              <SessionStatusBadge status={session.status} />
              {session.status === "completed" && session.debrief ? (
                <Link
                  href={`/dashboard/interview/${session.id}/debrief`}
                  className="text-[12px] font-medium text-orange-500 hover:text-orange-600"
                >
                  View debrief
                </Link>
              ) : session.status === "active" ? (
                <Link
                  href={`/dashboard/interview/${session.type}/${session.id}`}
                  className="text-[12px] font-medium text-blue-600 hover:text-blue-700"
                >
                  Resume
                </Link>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
