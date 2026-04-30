"use client"

import { Ban, ChevronDown, ChevronUp, Pause, Play, Sparkles, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { WorkflowTimeline } from "./WorkflowTimeline"
import type { WorkflowEngineActions } from "@/lib/scout/workflows/engine"

type Props = Pick<
  WorkflowEngineActions,
  | "activeWorkflow"
  | "continueStep"
  | "skipStep"
  | "pauseWorkflow"
  | "resumeWorkflow"
  | "cancelWorkflow"
  | "isExpanded"
  | "setExpanded"
>

export function WorkflowPanel({
  activeWorkflow,
  continueStep,
  skipStep,
  pauseWorkflow,
  resumeWorkflow,
  cancelWorkflow,
  isExpanded,
  setExpanded,
}: Props) {
  if (!activeWorkflow) return null

  const isPaused = Boolean(activeWorkflow.pausedAt)
  const isComplete = Boolean(activeWorkflow.completedAt)

  const settledCount = activeWorkflow.steps.filter(
    (s) => s.status === "completed" || s.status === "skipped"
  ).length
  const totalSteps = activeWorkflow.steps.length
  const pct = totalSteps > 0 ? Math.round((settledCount / totalSteps) * 100) : 0

  return (
    <div
      className={cn(
        "fixed bottom-6 right-6 z-40 w-[17rem] overflow-hidden rounded-2xl border bg-white",
        "shadow-[0_8px_32px_rgba(15,23,42,0.16)] transition-all duration-200",
        isComplete ? "border-emerald-200" : "border-slate-200/80"
      )}
    >
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div
        className={cn(
          "flex items-center gap-2.5 border-b px-3.5 py-2.5",
          isComplete ? "border-emerald-100 bg-emerald-50/60" : "border-slate-100 bg-white"
        )}
      >
        <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-lg bg-[#FF5C18] shadow-[0_2px_6px_rgba(255,92,24,0.4)]">
          <Sparkles className="h-2.5 w-2.5 text-white" />
        </span>

        <div className="flex-1 min-w-0">
          <p className="truncate text-[11.5px] font-bold leading-4 text-slate-900">
            {activeWorkflow.title}
          </p>
          <p className="text-[10px] leading-3 mt-0.5 text-slate-500">
            {isComplete
              ? "All steps complete"
              : isPaused
              ? "Paused"
              : `Step ${Math.min(settledCount + 1, totalSteps)} of ${totalSteps}`}
          </p>
        </div>

        <div className="flex items-center gap-0.5 flex-shrink-0">
          {!isComplete && (
            <button
              type="button"
              onClick={isPaused ? resumeWorkflow : pauseWorkflow}
              title={isPaused ? "Resume" : "Pause"}
              className="rounded p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            >
              {isPaused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
            </button>
          )}
          <button
            type="button"
            onClick={() => setExpanded(!isExpanded)}
            title={isExpanded ? "Collapse" : "Expand"}
            className="rounded p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
          </button>
          <button
            type="button"
            onClick={cancelWorkflow}
            title="Cancel and dismiss"
            className="rounded p-1 text-slate-400 transition hover:bg-red-50 hover:text-red-500"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* ── Progress bar ───────────────────────────────────────────────── */}
      <div className="h-0.5 w-full bg-slate-100">
        <div
          className={cn(
            "h-full transition-all duration-500",
            isComplete ? "bg-emerald-400" : "bg-[#FF5C18]"
          )}
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* ── Steps ──────────────────────────────────────────────────────── */}
      {isExpanded && !isPaused && !isComplete && (
        <div className="max-h-80 overflow-y-auto px-3.5 py-3">
          <WorkflowTimeline
            plan={activeWorkflow}
            onContinue={continueStep}
            onSkip={skipStep}
          />
        </div>
      )}

      {/* ── Paused state ───────────────────────────────────────────────── */}
      {isExpanded && isPaused && (
        <div className="px-3.5 py-3 text-center">
          <p className="text-[11px] text-slate-500">Workflow paused.</p>
          <button
            type="button"
            onClick={resumeWorkflow}
            className="mt-2 inline-flex items-center gap-1 rounded-full border border-[#FF5C18]/25 bg-[#FF5C18]/6 px-3 py-1 text-[11px] font-semibold text-[#FF5C18] transition hover:bg-[#FF5C18]/12"
          >
            <Play className="h-3 w-3" />
            Resume
          </button>
        </div>
      )}

      {/* ── Complete state ─────────────────────────────────────────────── */}
      {isComplete && isExpanded && (
        <div className="px-3.5 py-3 text-center">
          <p className="text-[12px] font-semibold text-emerald-700">All steps complete!</p>
          <button
            type="button"
            onClick={cancelWorkflow}
            className="mt-1.5 text-[11px] text-slate-400 transition hover:text-slate-600"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* ── Safety note ────────────────────────────────────────────────── */}
      {!isComplete && !isPaused && isExpanded && (
        <div className="border-t border-slate-100 px-3.5 py-2">
          <p className="flex items-center gap-1 text-[10px] text-slate-400">
            <Ban className="h-2.5 w-2.5 flex-shrink-0" />
            Nothing runs without your approval.
          </p>
        </div>
      )}
    </div>
  )
}
