"use client"

import { useMemo, useState } from "react"
import { Building2, CheckCircle2, Clock, ExternalLink, FileCheck, Moon } from "lucide-react"
import { cn } from "@/lib/utils"
import type { AutoApplyRecord } from "@/lib/apex/auto-apply/types"
import PendingQuestions, { type PendingQuestion } from "./PendingQuestions"
import AutoApplyToggle from "./AutoApplyToggle"

type Allowance = {
  allowed: number
  reason: string
  usedThisWeek: number
  weeklyCap: number
  enabled: boolean
} | null

type Props = {
  log: AutoApplyRecord[]
  allowance: Allowance
  questions: PendingQuestion[]
  enabled: boolean
}

/** Only outcomes the user can act on. 'skipped_cap' is bookkeeping, not an event. */
type Filter = "all" | "applied" | "prepared" | "needs_you"

/** Rendered at once. A month of runs is ~100 rows, which is a scroll, not a list. */
const PAGE = 20

/**
 * Day label for a run.
 *
 * The feed is chronological and the only question anyone opens it with is "what
 * happened last night", so runs are grouped by day rather than paginated —
 * page 2 of an undifferentiated list answers nothing.
 */
function dayLabel(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "Earlier"
  const today = new Date()
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((startOf(today) - startOf(d)) / 86_400_000)
  if (days <= 0) return "Last night"
  if (days === 1) return "Yesterday"
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: "long" })
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ""
  const mins = Math.round((Date.now() - then) / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}

export default function AutoApplyActivityClient({ log, allowance, questions, enabled }: Props) {
  const [filter, setFilter] = useState<Filter>("all")
  const [limit, setLimit] = useState(PAGE)

  const { applied, prepared, needsYou } = useMemo(() => {
    // A dry run is NOT an application. Counting the two together made the page
    // claim credit for work that never reached an employer — the header read
    // "Applications sent for you" above rows where nothing was sent.
    const applied = log.filter((r) => r.status === "applied")
    const prepared = log.filter((r) => r.status === "dry_run")
    // A failed row is only worth surfacing because the job is still open — the
    // user can finish it by hand. Shown as "needs you", never as an error.
    const needsYou = log.filter((r) => r.status === "failed")
    return { applied, prepared, needsYou }
  }, [log])

  const all = filter === "applied" ? applied
            : filter === "needs_you" ? needsYou
            : filter === "prepared" ? prepared
            : log
  const rows = all.slice(0, limit)

  // Switching tabs resets the page — carrying a deep scroll across a filter
  // change shows a stretch of history with no visible top.
  // Group the visible rows by day, preserving order.
  const groups: Array<{ label: string; items: AutoApplyRecord[] }> = []
  for (const r of rows) {
    const label = dayLabel(r.appliedAt)
    const last = groups[groups.length - 1]
    if (last && last.label === label) last.items.push(r)
    else groups.push({ label, items: [r] })
  }
  const thisWeek = allowance?.usedThisWeek ?? applied.length

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <header className="mb-6">
        <div className="flex items-center gap-2 text-slate-500">
          <Moon className="h-4 w-4" />
          <span className="text-xs font-medium uppercase tracking-wide">Overnight auto-apply</span>
        </div>
        {/* The heading follows the data. Claiming "sent for you" over a list
            where nothing was sent is the same lie as the green checkmark. */}
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">
          {applied.length > 0 ? "Applications sent for you" : "Your overnight runs"}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          {applied.length > 0
            ? "Hireoven applies to your strongest matches while you sleep. Everything it sent is here."
            : "Hireoven fills applications for your strongest matches while you sleep. Nothing has been submitted yet."}
        </p>
      </header>

      {/* Above the activity list on purpose: these are the reason applications
          stall, and each answer unblocks every future run. */}
      <PendingQuestions initial={questions} />

      <section className="mb-6 grid grid-cols-3 gap-3">
        <Stat label="Sent this week" value={String(thisWeek)}
          sub={allowance ? `of ${allowance.weeklyCap} included` : undefined} />
        {/* Shown only while there are any. Once submission is live this should
            be zero, and a permanent tile for it would imply otherwise. */}
        {prepared.length > 0
          ? <Stat label="Filled, not sent" value={String(prepared.length)} sub="test runs" />
          : <Stat label="Total sent" value={String(applied.length)} />}
        <Stat label="Need you" value={String(needsYou.length)}
          sub={needsYou.length ? "couldn't finish" : "nothing waiting"} />
      </section>

      <AutoApplyToggle
        initialEnabled={enabled}
        weeklyCap={allowance?.weeklyCap ?? 25}
        planEnabled={allowance?.enabled ?? false}
      />

      <div className="mb-4 flex gap-1">
        {([["all", "All"], ["applied", "Sent"],
           ...(prepared.length > 0 ? [["prepared", "Filled, not sent"] as const] : []),
           ["needs_you", "Needs you"]] as const).map(([key, label]) => (
          <button key={key} onClick={() => { setFilter(key); setLimit(PAGE) }}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              filter === key ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100",
            )}>
            {label}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 px-6 py-12 text-center">
          <Moon className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-3 text-sm font-medium text-slate-900">Nothing yet</p>
          <p className="mt-1 text-sm text-slate-500">
            Applications will appear here after your first overnight run.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {groups.map((g) => (
            <div key={g.label + g.items[0].id}>
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                {g.label}
                <span className="ml-1.5 font-normal normal-case tracking-normal text-slate-400">
                  · {g.items.length}
                </span>
              </h3>
              <ul className="divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200 bg-white">
                {g.items.map((r) => (
                  <li key={r.id} className="flex items-start gap-3 px-4 py-3.5">
                    <StatusIcon status={r.status} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-900">{r.jobTitle || "Untitled role"}</p>
                      <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-slate-500">
                        <Building2 className="h-3 w-3 shrink-0" />
                        {r.company || "Unknown company"}
                        {typeof r.matchScore === "number" && (
                          <span className="ml-1 rounded bg-emerald-50 px-1.5 py-0.5 font-medium text-emerald-700">
                            {Math.round(r.matchScore)}% match
                          </span>
                        )}
                      </p>
                      {r.status === "dry_run" && (
                  <p className="mt-1 text-xs text-slate-500">Filled and checked, not submitted.</p>
                )}
                {r.status === "failed" && (
                        <p className="mt-1 text-xs text-amber-700">
                          Couldn&apos;t complete this one — the form needs something only you can answer.
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="text-xs text-slate-400">{timeAgo(r.appliedAt)}</span>
                      {r.applyUrl && (
                        <a href={r.applyUrl} target="_blank" rel="noopener noreferrer"
                          className="text-slate-400 transition-colors hover:text-slate-700"
                          aria-label="Open the job posting">
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {all.length > rows.length && (
            <button
              onClick={() => setLimit((n) => n + PAGE)}
              className="w-full rounded-lg border border-slate-200 bg-white py-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
            >
              Show {Math.min(PAGE, all.length - rows.length)} more
              <span className="ml-1 text-slate-400">of {all.length - rows.length}</span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-400">{sub}</p>}
    </div>
  )
}

function StatusIcon({ status }: { status: AutoApplyRecord["status"] }) {
  if (status === "failed") {
    return <Clock className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-label="Needs you" />
  }
  // A filled-but-unsent run gets its own mark. Wearing the same green check as a
  // real application is the one thing this screen must never do: it would tell
  // someone they had applied when no employer received anything.
  if (status === "dry_run") {
    return <FileCheck className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-label="Filled, not sent" />
  }
  return <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-label="Sent" />
}
