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
  text:   { pill: "border-[#dbeafe] bg-[#eff6ff] text-[#2563eb]", dot: "bg-[#2563eb]" },
  live:   { pill: "border-[#e0d5ff] bg-[#f3eeff] text-[#7c3aed]", dot: "bg-[#7c3aed]" },
  coding: { pill: "border-[#bbf3da] bg-[#ecfdf5] text-[#0f9d6a]", dot: "bg-[#0f9d6a]" },
}

const PERSONA_LABELS: Record<string, string> = {
  friendly_recruiter: "Recruiter",
  skeptical_hm:       "Skeptical HM",
  senior_staff:       "Senior Peer",
  founder:            "Founder",
  panel:              "Panel",
}

function scoreColor(score: number | null) {
  if (score === null) return "text-[#98a1b0]"
  if (score >= 40) return "text-[#0b7a52]"
  if (score >= 20) return "text-[#c2530d]"
  return "text-[#dc2626]"
}

function scoreBg(score: number | null) {
  if (score === null) return "bg-[#f4f6f9]"
  if (score >= 40) return "bg-[#ecfdf5]"
  if (score >= 20) return "bg-[#fff7ed]"
  return "bg-[#fef2f2]"
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
      <section className={cn(className)}>
        <div className="mb-3 flex items-center justify-between">
          <div className="h-5 w-48 animate-pulse rounded-full bg-slate-100" />
          <div className="h-4 w-14 animate-pulse rounded-full bg-slate-100" />
        </div>
        <div className="mt-3 space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[66px] animate-pulse rounded-[14px] bg-slate-100" />
          ))}
        </div>
      </section>
    )
  }

  return (
    <section className={cn(className)}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[16px] font-bold text-[#0d1424]">Recent debriefs & rooms</h2>
        <Link
          href="/dashboard/interview/history"
          className="inline-flex items-center gap-1 text-[13px] font-semibold text-[#2563eb] transition hover:text-blue-700"
        >
          View all <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      <div className="space-y-2">
        {sessions.length === 0 ? (
          <div className="rounded-[14px] border border-[#eef0f4] bg-white px-4 py-5 text-[13px] text-[#98a1b0]">
            Finish a practice session and your debrief will show up here.
          </div>
        ) : sessions.map((session) => {
          const style = TYPE_STYLES[session.type] ?? { pill: "bg-slate-50 text-slate-600 ring-1 ring-slate-200", dot: "bg-slate-300" }
          const score = session.debrief?.overallScore ?? null
          const isCompleted = session.status === "completed" && session.debrief
          const isActive = session.status === "active"

          return (
            <div
              key={session.id}
              className="group flex items-center gap-[13px] rounded-[14px] border border-[#eef0f4] bg-white px-3.5 py-[13px] transition hover:border-[#dfe3ea]"
            >
              <span className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-[9px] py-1 text-[10.5px] font-bold uppercase tracking-[0.06em]",
                style.pill
              )}>
                <span className={cn("h-1.5 w-1.5 rounded-full", style.dot)} />
                {TYPE_LABELS[session.type] ?? session.type}
              </span>

              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-bold text-[#0f1729]">
                  {session.jobTitle
                    ? `${session.jobTitle}${session.jobCompany ? ` · ${session.jobCompany}` : ""}`
                    : "Generic practice"}
                </p>
                <p className="mt-0.5 truncate text-[12px] text-[#98a1b0]">
                  {PERSONA_LABELS[session.persona] ?? session.persona} · {formatDate(session.createdAt)}
                </p>
              </div>

              {score !== null && (
                <div className={cn(
                  "flex h-7 min-w-[34px] shrink-0 items-center justify-center rounded-lg px-2",
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
                    className="inline-flex h-[34px] items-center gap-1 rounded-[10px] border border-[#e7eaf0] bg-white px-3 text-[12.5px] font-semibold text-[#3f4856] transition hover:border-[#d6dbe4] hover:bg-[#f9fafb] active:translate-y-px"
                  >
                    Debrief <ArrowRight className="h-3 w-3" />
                  </Link>
                ) : isActive ? (
                  <Link
                    href={`/dashboard/interview/${session.type}/${session.id}`}
                    className="inline-flex h-[34px] items-center gap-1 rounded-[10px] border border-[#c4e3fb] bg-[#eef7ff] px-3 text-[12.5px] font-semibold text-[#0369a1] transition hover:bg-[#e0f2fe] active:translate-y-px"
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
