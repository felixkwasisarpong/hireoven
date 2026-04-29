"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Eye, Filter, Focus, HelpCircle, RotateCcw, Sparkles } from "lucide-react"
import type { ScoutActionRecordedDetail } from "./useScoutActionExecutor"
import { ScoutAuditPanel } from "./ScoutAuditPanel"

// ── Types ──────────────────────────────────────────────────────────────────

export type ScoutTimelineEntry = ScoutActionRecordedDetail & {
  jobCount?: number
  canUndo: boolean
}

const MAX_ENTRIES = 5
const UNDO_WINDOW_MS = 8_000

// ── Hook ───────────────────────────────────────────────────────────────────

export function useScoutTimeline(): ScoutTimelineEntry[] {
  const [entries, setEntries] = useState<ScoutTimelineEntry[]>([])
  // Stable ref used inside the timeout callback to avoid stale closure on `entries`
  const timeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  useEffect(() => {
    function onActionRecorded(e: Event) {
      const detail = (e as CustomEvent<ScoutActionRecordedDetail>).detail
      const entry: ScoutTimelineEntry = {
        ...detail,
        canUndo: !!detail.undoUrl,
      }
      setEntries((prev) => [entry, ...prev].slice(0, MAX_ENTRIES))

      // Auto-expire undo availability after the window closes
      if (detail.undoUrl) {
        const tid = setTimeout(() => {
          setEntries((prev) =>
            prev.map((en) => (en.id === entry.id ? { ...en, canUndo: false } : en))
          )
          timeoutsRef.current.delete(entry.id)
        }, UNDO_WINDOW_MS)
        timeoutsRef.current.set(entry.id, tid)
      }
    }

    function onFeedUpdated(e: Event) {
      const { totalCount } = (e as CustomEvent<{ totalCount: number }>).detail
      if (typeof totalCount !== "number") return
      // Patch job count into the most recent entry
      setEntries((prev) => {
        if (!prev.length) return prev
        return prev.map((en, i) => (i === 0 ? { ...en, jobCount: totalCount } : en))
      })
    }

    window.addEventListener("scout:action-recorded", onActionRecorded)
    window.addEventListener("scout:feed-updated", onFeedUpdated)
    return () => {
      window.removeEventListener("scout:action-recorded", onActionRecorded)
      window.removeEventListener("scout:feed-updated", onFeedUpdated)
      timeoutsRef.current.forEach(clearTimeout)
    }
  }, [])

  return entries
}

// ── Helpers ────────────────────────────────────────────────────────────────

function timeAgo(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000)
  if (diff < 10) return "just now"
  if (diff < 60) return `${diff}s ago`
  const mins = Math.floor(diff / 60)
  if (mins < 60) return `${mins}m ago`
  return `${Math.floor(mins / 60)}h ago`
}

function ActionIcon({ type }: { type: string }) {
  const cls = "h-3.5 w-3.5 flex-shrink-0"
  switch (type) {
    case "APPLY_FILTERS": return <Filter className={cls} />
    case "SET_FOCUS_MODE": return <Focus className={cls} />
    case "HIGHLIGHT_JOBS": return <Eye className={cls} />
    default: return <Sparkles className={cls} />
  }
}

// ── Component ──────────────────────────────────────────────────────────────

type ScoutActivityTimelineProps = {
  compact?: boolean
}

export function ScoutActivityTimeline({ compact = false }: ScoutActivityTimelineProps) {
  const router = useRouter()
  const entries = useScoutTimeline()
  const [activeAuditId, setActiveAuditId] = useState<string | null>(null)
  // Force re-render every 15 s so "time ago" labels stay fresh
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 15_000)
    return () => clearInterval(id)
  }, [])

  if (entries.length === 0) return null

  const hasAuditData = (entry: ScoutTimelineEntry) =>
    !!(entry.source ?? entry.reason ?? entry.previousStateSummary ?? entry.newStateSummary)

  if (compact) {
    return (
      <div className="border-t border-slate-100 px-3 py-2.5">
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
          Recent activity
        </p>
        <div className="space-y-1.5">
          {entries.map((entry) => (
            <div key={entry.id} className="flex items-center gap-2 text-slate-600">
              <span className="text-slate-400">
                <ActionIcon type={entry.actionType} />
              </span>
              <span className="min-w-0 flex-1 truncate text-[11px]">{entry.label}</span>
              {entry.jobCount !== undefined && entry.jobCount > 0 && (
                <span className="text-[10px] text-slate-400">{entry.jobCount.toLocaleString()} jobs</span>
              )}
              <span className="shrink-0 text-[10px] text-slate-400">{timeAgo(entry.timestamp)}</span>
              {entry.canUndo && entry.undoUrl && (
                <button
                  type="button"
                  onClick={() => router.push(entry.undoUrl!)}
                  className="shrink-0 inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-800"
                  title="Undo this action"
                >
                  <RotateCcw className="h-2.5 w-2.5" />
                  Undo
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <section>
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">
        Scout Activity
      </p>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {entries.map((entry, idx) => {
          const isAuditOpen = activeAuditId === entry.id
          const showAuditToggle = hasAuditData(entry)

          return (
            <div
              key={entry.id}
              className={idx < entries.length - 1 ? "border-b border-slate-100" : ""}
            >
              <div className="flex items-start gap-3 px-4 py-3">
                {/* Icon */}
                <div className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                  <ActionIcon type={entry.actionType} />
                </div>

                {/* Content */}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-800">{entry.label}</p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                    <span>{timeAgo(entry.timestamp)}</span>
                    {entry.jobCount !== undefined && entry.jobCount > 0 && (
                      <>
                        <span className="h-0.5 w-0.5 rounded-full bg-slate-300" />
                        <span className="font-medium text-slate-600">
                          Showing {entry.jobCount.toLocaleString()} job{entry.jobCount !== 1 ? "s" : ""}
                        </span>
                      </>
                    )}
                    {showAuditToggle && (
                      <>
                        <span className="h-0.5 w-0.5 rounded-full bg-slate-300" />
                        <button
                          type="button"
                          onClick={() => setActiveAuditId(isAuditOpen ? null : entry.id)}
                          className="inline-flex items-center gap-1 font-medium text-slate-500 transition hover:text-slate-700"
                        >
                          <HelpCircle className="h-3 w-3" />
                          {isAuditOpen ? "Hide" : "Why?"}
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Undo */}
                {entry.canUndo && entry.undoUrl && (
                  <button
                    type="button"
                    onClick={() => router.push(entry.undoUrl!)}
                    className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-white hover:text-slate-800 active:scale-95"
                  >
                    <RotateCcw className="h-3 w-3" />
                    Undo
                  </button>
                )}
              </div>

              {/* Inline audit detail */}
              {isAuditOpen && (
                <div className="border-t border-slate-100 px-4 pb-4 pt-0">
                  <ScoutAuditPanel
                    entry={{
                      actionType: entry.actionType,
                      label: entry.label,
                      timestamp: entry.timestamp,
                      source: entry.source,
                      reason: entry.reason,
                      previousStateSummary: entry.previousStateSummary,
                      newStateSummary: entry.newStateSummary,
                    }}
                    undoUrl={entry.undoUrl}
                    onUndo={entry.canUndo && entry.undoUrl ? () => router.push(entry.undoUrl!) : undefined}
                    onClose={() => setActiveAuditId(null)}
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
