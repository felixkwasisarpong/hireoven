"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { ArrowUpRight, CheckCircle2, Clock3, Loader2, RotateCcw, Target } from "lucide-react"

type ApexPlanExecutionSummary = {
  today: {
    runCount: number
    doneCount: number
    deferredCount: number
  }
  trailing7d: {
    runCount: number
    doneCount: number
    deferredCount: number
    activeDays: number
  }
  frequentDeferredTitles: string[]
  frequentCompletedTitles: string[]
  executionFingerprint: string
}

type PlanDailySummary = {
  date: string
  runCount: number
  doneCount: number
  deferredCount: number
}

type PlanHistoryItem = {
  itemId: string
  title?: string | null
  eyebrow?: string | null
  query?: string | null
  status?: "done" | "deferred" | null
  planDate: string
  updatedAt: string
  runCount: number
  lastRunAt?: string | null
}

type ApiResponse = {
  summary?: ApexPlanExecutionSummary
  daily?: PlanDailySummary[]
  history?: PlanHistoryItem[]
}

type Props = {
  onRunQuery?: (query: string) => void
}

function formatDayLabel(date: string): string {
  const parsed = new Date(`${date}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return date
  return new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(parsed)
}

function formatTimeLabel(iso: string | null | undefined): string | null {
  if (!iso) return null
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return null
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed)
}

export function ApexPlanExecutionPanel({ onRunQuery }: Props) {
  const [data, setData] = useState<ApiResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (mode: "initial" | "refresh" = "initial") => {
    if (mode === "initial") {
      setIsLoading(true)
    } else {
      setIsRefreshing(true)
    }
    setError(null)

    try {
      const res = await fetch("/api/apex/today-plan-state", {
        cache: "no-store",
        headers: { Accept: "application/json" },
      })

      if (!res.ok) {
        throw new Error(`Unexpected status ${res.status}`)
      }

      const payload = (await res.json().catch(() => null)) as ApiResponse | null
      setData(payload)
    } catch {
      setError("Unable to load plan execution history right now.")
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void load("initial")
  }, [load])

  const summary = data?.summary ?? null
  const daily = data?.daily ?? []
  const history = data?.history ?? []

  const followThrough = useMemo(() => {
    if (!summary) return null
    const totalResolved = summary.trailing7d.doneCount + summary.trailing7d.deferredCount
    if (totalResolved <= 0) return null
    return Math.round((summary.trailing7d.doneCount / totalResolved) * 100)
  }, [summary])

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-[0_1px_0_rgba(15,23,42,0.04)]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              <Target className="h-3.5 w-3.5 text-blue-600" />
              Plan execution
            </p>
            <p className="mt-1 text-[13px] leading-5 text-slate-600">
              Audit how today&apos;s plan is actually being executed across sessions.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load("refresh")}
            disabled={isRefreshing}
            className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-600 transition hover:border-blue-200 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RotateCcw className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        {isLoading ? (
          <div className="mt-4 flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading plan execution history...
          </div>
        ) : error ? (
          <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4 text-[13px] text-rose-700">
            {error}
          </div>
        ) : !summary ? (
          <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-4 text-[13px] text-slate-500">
            No execution data is available yet.
          </div>
        ) : (
          <>
            <div className="mt-4 grid gap-2.5 sm:grid-cols-3">
              <div className="rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Today</p>
                <p className="mt-1.5 text-2xl font-semibold tracking-tight text-slate-950">{summary.today.runCount}</p>
                <p className="mt-1 text-[11px] text-slate-500">
                  {summary.today.doneCount} done · {summary.today.deferredCount} later
                </p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Trailing 7 days</p>
                <p className="mt-1.5 text-2xl font-semibold tracking-tight text-slate-950">{summary.trailing7d.runCount}</p>
                <p className="mt-1 text-[11px] text-slate-500">
                  {summary.trailing7d.activeDays} active days
                </p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Follow-through</p>
                <p className="mt-1.5 text-2xl font-semibold tracking-tight text-slate-950">
                  {followThrough === null ? "--" : `${followThrough}%`}
                </p>
                <p className="mt-1 text-[11px] text-slate-500">
                  {summary.trailing7d.doneCount} completed vs {summary.trailing7d.deferredCount} deferred
                </p>
              </div>
            </div>

            {(summary.frequentCompletedTitles.length > 0 || summary.frequentDeferredTitles.length > 0) && (
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 px-4 py-4">
                  <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-700">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Repeatedly completed
                  </p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {summary.frequentCompletedTitles.length > 0 ? summary.frequentCompletedTitles.map((title) => (
                      <span key={title} className="rounded-full border border-emerald-200 bg-white/90 px-2.5 py-1 text-[11px] font-medium text-emerald-800">
                        {title}
                      </span>
                    )) : (
                      <span className="text-[12px] text-emerald-700/80">No repeated completions yet.</span>
                    )}
                  </div>
                </div>
                <div className="rounded-2xl border border-amber-200 bg-amber-50/60 px-4 py-4">
                  <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-amber-700">
                    <Clock3 className="h-3.5 w-3.5" />
                    Repeatedly deferred
                  </p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {summary.frequentDeferredTitles.length > 0 ? summary.frequentDeferredTitles.map((title) => (
                      <span key={title} className="rounded-full border border-amber-200 bg-white/90 px-2.5 py-1 text-[11px] font-medium text-amber-800">
                        {title}
                      </span>
                    )) : (
                      <span className="text-[12px] text-amber-700/80">Nothing is repeatedly getting pushed out.</span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {!isLoading && !error && summary && (
        <>
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-[0_1px_0_rgba(15,23,42,0.04)]">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-slate-500">Last 7 days</p>
            <div className="mt-3 space-y-2">
              {daily.length > 0 ? daily.map((row) => (
                <div key={row.date} className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2">
                  <div>
                    <p className="text-[12px] font-semibold text-slate-800">{formatDayLabel(row.date)}</p>
                    <p className="text-[11px] text-slate-500">
                      {row.doneCount} done · {row.deferredCount} later
                    </p>
                  </div>
                  <p className="text-[12px] font-semibold text-slate-700">{row.runCount} runs</p>
                </div>
              )) : (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-3 py-3 text-[12px] text-slate-500">
                  No execution activity has been recorded in the last 7 days.
                </div>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-[0_1px_0_rgba(15,23,42,0.04)]">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-slate-500">Recent item log</p>
            <div className="mt-3 space-y-2">
              {history.length > 0 ? history.map((item) => {
                const runAt = formatTimeLabel(item.lastRunAt)
                const updatedAt = formatTimeLabel(item.updatedAt)
                const title = item.title?.trim() || item.itemId
                const runnableQuery = item.query?.trim() || null
                const statusLabel =
                  item.status === "done"
                    ? "Done"
                    : item.status === "deferred"
                      ? "Deferred"
                      : item.runCount > 0
                        ? "Ran"
                        : "Tracked"

                return (
                  <div key={`${item.planDate}:${item.itemId}`} className="rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        {item.eyebrow && (
                          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">{item.eyebrow}</p>
                        )}
                        <p className="mt-1 text-[12.5px] font-semibold leading-5 text-slate-900">{title}</p>
                        <p className="mt-1 text-[11px] text-slate-500">
                          {formatDayLabel(item.planDate)}
                          {runAt ? ` · last run ${runAt}` : updatedAt ? ` · updated ${updatedAt}` : ""}
                        </p>
                      </div>
                      <span
                        className={[
                          "rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                          item.status === "done"
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : item.status === "deferred"
                              ? "border-amber-200 bg-amber-50 text-amber-700"
                              : "border-slate-200 bg-white text-slate-600",
                        ].join(" ")}
                      >
                        {statusLabel}
                      </span>
                    </div>

                    <div className="mt-2 flex items-center justify-between gap-3">
                      <p className="text-[11px] text-slate-500">{item.runCount} run{item.runCount === 1 ? "" : "s"}</p>
                      {runnableQuery && onRunQuery && (
                        <button
                          type="button"
                          onClick={() => onRunQuery(runnableQuery)}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 transition hover:opacity-75"
                        >
                          Run again
                          <ArrowUpRight className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                )
              }) : (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-3 py-3 text-[12px] text-slate-500">
                  No recent plan actions have been recorded yet.
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
