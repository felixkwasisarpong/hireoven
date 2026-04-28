"use client"

import { HelpCircle, RotateCcw, X } from "lucide-react"
import type { ScoutAuditEntry, ScoutActionSource } from "./useScoutActionExecutor"

// ── Source badge config ─────────────────────────────────────────────────────

const SOURCE_CONFIG: Record<ScoutActionSource, { label: string; color: string }> = {
  chat:     { label: "Chat response", color: "bg-blue-100 text-blue-700" },
  nudge:    { label: "Scout nudge",   color: "bg-orange-100 text-orange-700" },
  strategy: { label: "Strategy plan", color: "bg-orange-100 text-orange-700" },
  workflow: { label: "Workflow",      color: "bg-emerald-100 text-emerald-700" },
}

// ── Props ────────────────────────────────────────────────────────────────────

type ScoutAuditPanelProps = {
  entry: ScoutAuditEntry
  undoUrl?: string
  onUndo?: () => void
  onClose: () => void
}

// ── Component ────────────────────────────────────────────────────────────────

export function ScoutAuditPanel({ entry, undoUrl, onUndo, onClose }: ScoutAuditPanelProps) {
  const sourceConfig = entry.source ? SOURCE_CONFIG[entry.source] : null

  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs animate-in fade-in slide-in-from-top-1 duration-150">
      {/* Header */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <HelpCircle className="h-3.5 w-3.5 text-slate-500" />
          <span className="font-semibold text-slate-700">Why did Scout do this?</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-5 w-5 items-center justify-center rounded text-slate-400 transition hover:bg-slate-200 hover:text-slate-600"
          aria-label="Close audit details"
        >
          <X className="h-3 w-3" />
        </button>
      </div>

      <div className="space-y-2.5">
        {/* Action label + source badge */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-slate-800">{entry.label}</span>
          {sourceConfig && (
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${sourceConfig.color}`}>
              {sourceConfig.label}
            </span>
          )}
        </div>

        {/* Before / After */}
        {(entry.previousStateSummary || entry.newStateSummary) && (
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white divide-y divide-slate-100">
            {entry.previousStateSummary && (
              <div className="flex items-baseline gap-2 px-2.5 py-1.5">
                <span className="w-10 shrink-0 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  Before
                </span>
                <span className="text-slate-600">{entry.previousStateSummary}</span>
              </div>
            )}
            {entry.newStateSummary && (
              <div className="flex items-baseline gap-2 px-2.5 py-1.5">
                <span className="w-10 shrink-0 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  After
                </span>
                <span className="font-medium text-slate-800">{entry.newStateSummary}</span>
              </div>
            )}
          </div>
        )}

        {/* Reason */}
        {entry.reason && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              Scout&apos;s reason
            </p>
            <p className="mt-1 leading-5 text-slate-600 line-clamp-4">{entry.reason}</p>
          </div>
        )}

        {/* Undo */}
        {onUndo && undoUrl && (
          <button
            type="button"
            onClick={onUndo}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800 active:scale-95"
          >
            <RotateCcw className="h-3 w-3" />
            Undo this change
          </button>
        )}
      </div>
    </div>
  )
}
