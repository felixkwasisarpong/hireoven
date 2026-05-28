"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import SessionStatusBadge from "@/components/interview/SessionStatusBadge"
import ScoreBadge from "@/components/interview/ScoreBadge"
import { cn } from "@/lib/utils"

type Session = {
  id: string
  type: string
  persona: string
  status: string
  durationTargetMin: number
  jobId: string | null
  jobTitle: string | null
  jobCompany: string | null
  createdAt: string
  startedAt: string | null
  debrief: { overallScore: number | null } | null
}

type HistoryTableProps = {
  initialSessions?: Session[]
  initialLoaded?: boolean
}

const TYPE_LABELS: Record<string, string> = { text: "Text", live: "Live", coding: "Coding" }
const TYPE_COLORS: Record<string, string> = {
  text:   "bg-blue-50 text-blue-700",
  live:   "bg-purple-50 text-purple-700",
  coding: "bg-amber-50 text-amber-700",
}
const PERSONA_LABELS: Record<string, string> = {
  friendly_recruiter: "Recruiter",
  skeptical_hm:       "Skeptical HM",
  senior_staff:       "Senior Peer",
  founder:            "Founder",
  panel:              "Panel",
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  })
}

export default function HistoryTable({
  initialSessions = [],
  initialLoaded = false,
}: HistoryTableProps) {
  const [sessions, setSessions] = useState<Session[]>(initialSessions)
  const [loading, setLoading] = useState(!initialLoaded)
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 50

  // Filters
  const [filterType, setFilterType] = useState("all")
  const [filterStatus, setFilterStatus] = useState("all")
  const [filterJobId, setFilterJobId] = useState("all")

  // Confirm discard dialog
  const [discardId, setDiscardId] = useState<string | null>(null)

  useEffect(() => {
    if (initialLoaded) return

    fetch("/api/interview/sessions?limit=200")
      .then((r) => r.json())
      .then((d) => setSessions(d.sessions ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [initialLoaded])

  // Build unique jobs from sessions for the job filter dropdown
  const jobOptions = useMemo(() => {
    const seen = new Map<string, string>()
    sessions.forEach((s) => {
      if (s.jobId && !seen.has(s.jobId)) {
        seen.set(s.jobId, s.jobTitle ? `${s.jobTitle}${s.jobCompany ? ` @ ${s.jobCompany}` : ""}` : s.jobId)
      }
    })
    return Array.from(seen.entries()).map(([id, label]) => ({ id, label }))
  }, [sessions])

  const filtered = useMemo(() => {
    return sessions.filter((s) => {
      if (filterType !== "all" && s.type !== filterType) return false
      if (filterStatus !== "all" && s.status !== filterStatus) return false
      if (filterJobId !== "all" && s.jobId !== filterJobId) return false
      return true
    })
  }, [sessions, filterType, filterStatus, filterJobId])

  const paginated = filtered.slice(0, page * PAGE_SIZE)

  async function handleDiscard(id: string) {
    await fetch(`/api/interview/sessions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "abandoned" }),
    })
    setSessions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, status: "abandoned" } : s))
    )
    setDiscardId(null)
  }

  const selectCls =
    "rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12px] text-slate-700 focus:border-orange-300 focus:outline-none"

  return (
    <div>
      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className={selectCls}>
          <option value="all">All types</option>
          <option value="text">Text</option>
          <option value="live">Live</option>
          <option value="coding">Coding</option>
        </select>
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className={selectCls}>
          <option value="all">All statuses</option>
          <option value="completed">Completed</option>
          <option value="active">Active</option>
          <option value="abandoned">Abandoned</option>
        </select>
        {jobOptions.length > 0 && (
          <select value={filterJobId} onChange={(e) => setFilterJobId(e.target.value)} className={selectCls}>
            <option value="all">All jobs</option>
            {jobOptions.map((j) => (
              <option key={j.id} value={j.id}>{j.label}</option>
            ))}
          </select>
        )}
      </div>

      {/* Table */}
      <div className="mt-4">
        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-14 animate-pulse rounded-lg bg-slate-100" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-[14px] font-medium text-slate-600">
              No interview sessions yet. Start your first one from the hub.
            </p>
            <Link
              href="/dashboard/interview"
              className="mt-4 inline-flex items-center rounded-lg bg-orange-500 px-4 py-2 text-[13px] font-semibold text-white hover:bg-orange-600"
            >
              Go to interview hub
            </Link>
          </div>
        ) : (
          <>
            <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
              {paginated.map((session) => (
                <div key={session.id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:flex-nowrap">
                  {/* Date */}
                  <span className="w-[90px] shrink-0 text-[12px] text-slate-400">
                    {formatDate(session.createdAt)}
                  </span>

                  {/* Type badge */}
                  <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", TYPE_COLORS[session.type] ?? "bg-slate-100 text-slate-600")}>
                    {TYPE_LABELS[session.type] ?? session.type}
                  </span>

                  {/* Persona + role */}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-slate-900">
                      {session.jobTitle
                        ? `${session.jobTitle}${session.jobCompany ? ` @ ${session.jobCompany}` : ""}`
                        : "Generic"}
                    </p>
                    <p className="text-[11px] text-slate-400">
                      {PERSONA_LABELS[session.persona] ?? session.persona} · {session.durationTargetMin} min
                    </p>
                  </div>

                  {/* Score */}
                  <div className="shrink-0">
                    <ScoreBadge score={session.debrief?.overallScore} />
                  </div>

                  {/* Status */}
                  <div className="shrink-0">
                    <SessionStatusBadge status={session.status} />
                  </div>

                  {/* Actions */}
                  <div className="flex shrink-0 items-center gap-2">
                    {session.status === "completed" ? (
                      <Link
                        href={`/dashboard/interview/${session.id}/debrief`}
                        className="text-[12px] font-medium text-orange-500 hover:text-orange-600"
                      >
                        View debrief
                      </Link>
                    ) : session.status === "active" ? (
                      <>
                        <Link
                          href={`/dashboard/interview/${session.type}/${session.id}`}
                          className="text-[12px] font-medium text-blue-600 hover:text-blue-700"
                        >
                          Resume
                        </Link>
                        <button
                          type="button"
                          onClick={() => setDiscardId(session.id)}
                          className="text-[12px] font-medium text-slate-400 hover:text-red-500"
                        >
                          Discard
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>

            {paginated.length < filtered.length && (
              <button
                type="button"
                onClick={() => setPage((p) => p + 1)}
                className="mt-4 w-full rounded-lg border border-slate-200 bg-white py-2 text-[13px] font-medium text-slate-600 hover:bg-slate-50"
              >
                Load more ({filtered.length - paginated.length} remaining)
              </button>
            )}
          </>
        )}
      </div>

      {/* Discard confirm dialog */}
      {discardId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="mx-4 w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-[15px] font-semibold text-slate-900">Discard this session?</h3>
            <p className="mt-1.5 text-[13px] text-slate-500">
              The session will be marked as abandoned. This cannot be undone.
            </p>
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => setDiscardId(null)}
                className="flex-1 rounded-lg border border-slate-200 py-2 text-[13px] font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleDiscard(discardId)}
                className="flex-1 rounded-lg bg-red-500 py-2 text-[13px] font-semibold text-white hover:bg-red-600"
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
