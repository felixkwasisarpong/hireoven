"use client"

import { useEffect, useState } from "react"
import { AlertCircle, ArrowRight, CheckCircle2 } from "lucide-react"
import Link from "next/link"
import { ScoutActivityTimeline } from "@/components/scout/ScoutActivityTimeline"
import { analyzeFollowUp } from "@/lib/scout/follow-up"
import type { JobApplication } from "@/types"

// ── Stale applications nudge ──────────────────────────────────────────────────

type StaleApp = {
  id: string
  company_name: string
  job_title: string
  daysStale: number
  urgency: string | null
}

function FollowUpNudgePanel() {
  const [staleApps, setStaleApps] = useState<StaleApp[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    fetch("/api/applications")
      .then((r) => r.json() as Promise<{ applications?: JobApplication[] } | JobApplication[]>)
      .then((data) => {
        const apps: JobApplication[] = Array.isArray(data)
          ? data
          : (data as { applications?: JobApplication[] }).applications ?? []

        const stale = apps
          .map((app) => {
            const analysis = analyzeFollowUp(app)
            if (analysis.status !== "ready") return null
            return {
              id: app.id,
              company_name: app.company_name,
              job_title: app.job_title,
              daysStale: analysis.daysStale ?? 0,
              urgency: analysis.urgency,
            }
          })
          .filter((x): x is StaleApp => x !== null)
          .sort((a, b) => b.daysStale - a.daysStale)
          .slice(0, 5)

        setStaleApps(stale)
      })
      .catch(() => {})
      .finally(() => setLoaded(true))
  }, [])

  if (!loaded || staleApps.length === 0) return null

  return (
    <div className="overflow-hidden rounded-2xl border border-amber-200/80 bg-amber-50/60 shadow-[0_2px_8px_rgba(15,23,42,0.04)]">
      <div className="flex items-center gap-2.5 border-b border-amber-200/60 px-5 py-3.5">
        <AlertCircle className="h-4 w-4 flex-shrink-0 text-amber-600" />
        <p className="text-[12px] font-bold text-amber-900">
          {staleApps.length} application{staleApps.length !== 1 ? "s" : ""} may need a follow-up
        </p>
      </div>

      <ul className="divide-y divide-amber-200/50">
        {staleApps.map((app) => (
          <li key={app.id} className="flex items-center justify-between px-5 py-3">
            <div className="min-w-0">
              <p className="truncate text-[12.5px] font-semibold text-slate-900">
                {app.job_title}
              </p>
              <p className="text-[11.5px] text-slate-500">
                {app.company_name} · {app.daysStale}d ago
              </p>
            </div>
            <span
              className={
                app.urgency === "high"
                  ? "ml-3 flex-shrink-0 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10.5px] font-semibold text-red-700"
                  : "ml-3 flex-shrink-0 rounded-full border border-amber-200 bg-amber-100 px-2 py-0.5 text-[10.5px] font-semibold text-amber-800"
              }
            >
              {app.urgency === "high" ? "Urgent" : "Follow up"}
            </span>
          </li>
        ))}
      </ul>

      <div className="border-t border-amber-200/60 px-5 py-3">
        <Link
          href="/dashboard/applications"
          className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-amber-800 transition hover:text-amber-900"
        >
          Open Applications pipeline
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  )
}

// ── Tab ───────────────────────────────────────────────────────────────────────

export function ScoutActivityTab() {
  return (
    <div className="space-y-5">
      <FollowUpNudgePanel />

      <ScoutActivityTimeline />

      {/* Static context card */}
      <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-[0_2px_16px_rgba(15,23,42,0.06)]">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-500" />
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">
              About Scout Activity
            </p>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Scout logs every action it takes — filter changes, focus mode, job highlights, and
              more. Each entry explains what changed, why, and how many jobs are now showing.
              Actions with an undo window let you revert changes instantly.
            </p>
            <p className="mt-2 text-xs text-slate-400">
              Activity appears here as you use Scout in this session.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
