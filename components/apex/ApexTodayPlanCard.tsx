"use client"

import { ArrowRight, CheckCircle2, Clock3, Loader2, RotateCcw, Sparkles, Target } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import type { CareerTwinSnapshot } from "@/lib/apex/career-twin/types"
import type { ApexNudge } from "@/lib/apex/nudges"
import type { ApexStrategyBoard } from "@/lib/apex/types"
import { buildTodayPlanModel } from "@/lib/apex/plan/generator"
import {
  patchTodayPlanItemState,
  readTodayPlanItemState,
  writeTodayPlanItemState,
  type ApexTodayPlanItemState,
} from "@/lib/apex/plan/store"

type Props = {
  board: ApexStrategyBoard | null
  nudges?: ApexNudge[]
  isLoading?: boolean
  hasData?: boolean
  onActionClick?: (query: string) => void
  onOpenHistory?: () => void
  onPlanStateCommitted?: () => void
  twin?: CareerTwinSnapshot | null
  history?: CareerTwinSnapshot[]
  variant?: "full" | "summary"
}

export function ApexTodayPlanCard({
  board,
  nudges = [],
  isLoading = false,
  hasData = false,
  onActionClick,
  onOpenHistory,
  onPlanStateCommitted,
  twin = null,
  history = [],
  variant = "full",
}: Props) {
  const isSummary = variant === "summary"
  const planModel = useMemo(
    () => buildTodayPlanModel({ board, nudges, hasData, twin, history }),
    [board, nudges, hasData, twin, history]
  )
  const items = planModel.items
  const snapshot = board?.snapshot ?? null
  const [itemState, setItemState] = useState<Record<string, ApexTodayPlanItemState>>({})
  const [expandedItems, setExpandedItems] = useState<string[]>([])

  useEffect(() => {
    const cached = readTodayPlanItemState()
    setItemState(cached)

    let cancelled = false

    void (async () => {
      try {
        const res = await fetch("/api/apex/today-plan-state", {
          cache: "no-store",
          headers: { Accept: "application/json" },
        })
        if (!res.ok) return

        const data = (await res.json().catch(() => null)) as {
          items?: Record<string, { status?: "done" | "deferred" | null; updatedAt?: string }>
        } | null

        const serverState = Object.fromEntries(
          Object.entries(data?.items ?? {})
            .filter(([, value]) => value?.status === "done" || value?.status === "deferred")
            .map(([itemId, value]) => [
              itemId,
              {
                status: value.status as "done" | "deferred",
                updatedAt: value.updatedAt ?? new Date().toISOString(),
              },
            ])
        ) as Record<string, ApexTodayPlanItemState>

        if (!cancelled) {
          setItemState(serverState)
          writeTodayPlanItemState(serverState)
        }
      } catch {
        // Keep local cache as best-effort fallback.
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  function persistPlanState(args: {
    itemId: string
    title: string
    eyebrow: string
    query: string
    status: "done" | "deferred" | null
    recordRun?: boolean
  }) {
    void fetch("/api/apex/today-plan-state", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(args),
    })
      .then((res) => {
        if (!res.ok) return
        onPlanStateCommitted?.()
      })
      .catch(() => {
        // Local cache already updated; server sync is best-effort.
      })
  }

  function setStatus(itemId: string, status: "done" | "deferred" | null, meta: { title: string; eyebrow: string; query: string }) {
    setItemState((current) => patchTodayPlanItemState(current, itemId, status))
    persistPlanState({
      itemId,
      title: meta.title,
      eyebrow: meta.eyebrow,
      query: meta.query,
      status,
      recordRun: false,
    })
  }

  function toggleExpanded(itemId: string) {
    setExpandedItems((current) =>
      current.includes(itemId)
        ? current.filter((id) => id !== itemId)
        : [...current, itemId]
    )
  }

  const activeItems = items.filter((item) => !itemState[item.id])
  const doneItems = items.filter((item) => itemState[item.id]?.status === "done")
  const deferredItems = items.filter((item) => itemState[item.id]?.status === "deferred")
  const summaryItems = activeItems.slice(0, 2)
  const leadItem = activeItems[0] ?? items[0] ?? null

  function handleRun(item: (typeof items)[number]) {
    persistPlanState({
      itemId: item.id,
      title: item.title,
      eyebrow: item.eyebrow,
      query: item.query,
      status: itemState[item.id]?.status ?? null,
      recordRun: true,
    })
    onActionClick?.(item.query)
  }

  if (isSummary) {
    return (
      <section className="rounded-[24px] border border-slate-200 bg-white px-5 py-5 shadow-[0_10px_30px_rgba(15,23,42,0.06)] sm:px-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">
              <Target className="h-3 w-3" />
              Today&apos;s Plan
            </div>
            <h3 className="mt-2.5 text-[18px] font-semibold tracking-tight text-slate-950">
              {leadItem?.title ?? "Start with the highest-leverage move."}
            </h3>
            <p className="mt-1.5 text-sm leading-6 text-slate-500">
              {planModel.contextNote
                ?? leadItem?.detail
                ?? "Apex keeps the next steps short, ranked, and ready to run."}
            </p>
          </div>
          <div className="rounded-2xl border border-blue-100 bg-blue-50 px-3 py-2 text-right">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-blue-500">Today</p>
            <p className="mt-1 text-[13px] font-semibold text-blue-900">{activeItems.length} active</p>
            <p className="mt-1 text-[10px] text-blue-700/80">
              {doneItems.length} done · {deferredItems.length} later
            </p>
          </div>
        </div>

        {snapshot && (
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold text-slate-600">
              {snapshot.savedJobs} tracked
            </span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold text-slate-600">
              {snapshot.activeApplications} active apps
            </span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold text-slate-600">
              {snapshot.averageMatchScore === null ? "Avg match --" : `Avg match ${snapshot.averageMatchScore}%`}
            </span>
          </div>
        )}

        <div className="mt-4 space-y-2.5">
          {isLoading ? (
            <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Building today&apos;s plan...
            </div>
          ) : summaryItems.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-sm font-medium text-slate-700">No active items right now.</p>
            </div>
          ) : (
            summaryItems.map((item, index) => (
              <div
                key={item.id}
                className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
                    {index + 1}. {item.eyebrow}
                  </p>
                  <p className="mt-1 truncate text-sm font-semibold text-slate-900">{item.title}</p>
                </div>
                <button
                  type="button"
                  onClick={() => handleRun(item)}
                  className="inline-flex flex-shrink-0 items-center gap-1 rounded-full border border-slate-900 bg-slate-900 px-3 py-1.5 text-[11px] font-semibold text-white transition hover:border-blue-700 hover:bg-blue-700"
                >
                  Run
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            ))
          )}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {onOpenHistory && (
            <button
              type="button"
              onClick={onOpenHistory}
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-600 transition hover:border-blue-200 hover:text-blue-700"
            >
              View execution history
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          )}
          {leadItem && onActionClick && (
            <button
              type="button"
              onClick={() => handleRun(leadItem)}
              className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-[11px] font-semibold text-blue-700 transition hover:bg-blue-100"
            >
              Run top move
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </section>
    )
  }

  return (
    <section className="rounded-[28px] border border-slate-200 bg-[linear-gradient(180deg,rgba(255,255,255,1)_0%,rgba(246,250,255,1)_100%)] px-5 py-5 shadow-[0_14px_38px_rgba(15,23,42,0.08)] sm:px-6 sm:py-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">
            <Target className="h-3 w-3" />
            Today&apos;s Plan
          </div>
          <h3 className="mt-2.5 text-[20px] font-semibold tracking-tight text-slate-950">
            Run the highest-leverage moves first.
          </h3>
          <p className="mt-1.5 max-w-xl text-sm leading-6 text-slate-500">
            Apex compresses your search into a short operating plan so the day starts with decisions, not noise.
          </p>
          {onOpenHistory && (
            <button
              type="button"
              onClick={onOpenHistory}
              className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-600 transition hover:border-blue-200 hover:text-blue-700"
            >
              View execution history
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <div className="rounded-2xl border border-blue-100 bg-blue-50 px-3 py-2 text-right">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-blue-500">Apex</p>
          <p className="mt-1 text-[13px] font-semibold text-blue-900">
            {snapshot ? `${snapshot.savedJobs} tracked` : "Live"}
          </p>
          <p className="mt-1 text-[10px] text-blue-700/80">
            {activeItems.length} active
            {(doneItems.length > 0 || deferredItems.length > 0) && ` · ${doneItems.length} done · ${deferredItems.length} later`}
          </p>
        </div>
      </div>

      {planModel.contextNote && (
        <div className="mt-4 rounded-2xl border border-violet-100 bg-violet-50/80 px-4 py-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-violet-600">Adaptive Plan</p>
          <p className="mt-1 text-[13px] leading-5 text-violet-900">{planModel.contextNote}</p>
        </div>
      )}

      {snapshot && (
        <div className="mt-5 grid gap-2.5 sm:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white/90 px-4 py-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Saved Jobs</p>
            <p className="mt-1.5 text-2xl font-semibold tracking-tight text-slate-950">{snapshot.savedJobs}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white/90 px-4 py-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Active Apps</p>
            <p className="mt-1.5 text-2xl font-semibold tracking-tight text-slate-950">{snapshot.activeApplications}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white/90 px-4 py-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Avg Match</p>
            <p className="mt-1.5 text-2xl font-semibold tracking-tight text-slate-950">
              {snapshot.averageMatchScore === null ? "--" : `${snapshot.averageMatchScore}%`}
            </p>
          </div>
        </div>
      )}

      <div className="mt-5 space-y-3">
        {isLoading ? (
          <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-4 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Building today&apos;s plan from your current strategy data...
          </div>
        ) : activeItems.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
            <p className="text-sm font-semibold text-slate-900">Today&apos;s active plan is clear.</p>
            <p className="mt-1 text-[13px] leading-5 text-slate-500">
              Restore deferred items or refresh Apex context if you want a new operating sequence.
            </p>
          </div>
        ) : (
          activeItems.map((item, index) => (
            <div
              key={item.id}
              className="rounded-2xl border border-slate-200 bg-white/95 px-4 py-4 transition-all hover:border-blue-200 hover:bg-blue-50/40"
            >
              <div className="flex items-start gap-4">
                <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-sm font-semibold text-white">
                  {index + 1}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">{item.eyebrow}</p>
                  <p className="mt-1 text-sm font-semibold leading-5 text-slate-900">{item.title}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => toggleExpanded(item.id)}
                      className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 transition hover:border-blue-200 hover:text-blue-700"
                    >
                      {expandedItems.includes(item.id) ? "Hide why" : "Why this matters"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setStatus(item.id, "done", { title: item.title, eyebrow: item.eyebrow, query: item.query })}
                      className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700 transition hover:bg-emerald-100"
                    >
                      Mark done
                    </button>
                    <button
                      type="button"
                      onClick={() => setStatus(item.id, "deferred", { title: item.title, eyebrow: item.eyebrow, query: item.query })}
                      className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700 transition hover:bg-amber-100"
                    >
                      Defer
                    </button>
                  </div>
                  {expandedItems.includes(item.id) && (
                    <div className="mt-3 rounded-2xl border border-blue-100 bg-blue-50/70 px-3 py-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-700">Why this matters</p>
                      <p className="mt-1.5 text-[13px] leading-5 text-blue-900">{item.detail}</p>
                      <div className="mt-2 flex items-start gap-2 rounded-xl border border-white/80 bg-white/70 px-3 py-2">
                        <Sparkles className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-blue-600" />
                        <p className="text-[12px] leading-5 text-slate-600">{item.impact}</p>
                      </div>
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => handleRun(item)}
                  className="group inline-flex flex-shrink-0 items-center gap-1 rounded-full bg-slate-950 px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-blue-700"
                >
                  Run with Apex
                  <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {(doneItems.length > 0 || deferredItems.length > 0) && (
        <div className="mt-5 grid gap-3 lg:grid-cols-2">
          {doneItems.length > 0 && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 px-4 py-4">
              <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-700">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Completed
              </p>
              <div className="mt-3 space-y-2">
                {doneItems.map((item) => (
                  <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl border border-emerald-200/70 bg-white/80 px-3 py-2">
                    <p className="text-[12px] font-medium text-slate-700">{item.title}</p>
                    <button
                      type="button"
                      onClick={() => setStatus(item.id, null, { title: item.title, eyebrow: item.eyebrow, query: item.query })}
                      className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 transition hover:opacity-70"
                    >
                      <RotateCcw className="h-3 w-3" />
                      Restore
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {deferredItems.length > 0 && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50/60 px-4 py-4">
              <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-amber-700">
                <Clock3 className="h-3.5 w-3.5" />
                Later
              </p>
              <div className="mt-3 space-y-2">
                {deferredItems.map((item) => (
                  <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl border border-amber-200/70 bg-white/80 px-3 py-2">
                    <p className="text-[12px] font-medium text-slate-700">{item.title}</p>
                    <button
                      type="button"
                      onClick={() => setStatus(item.id, null, { title: item.title, eyebrow: item.eyebrow, query: item.query })}
                      className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 transition hover:opacity-70"
                    >
                      <RotateCcw className="h-3 w-3" />
                      Restore
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
