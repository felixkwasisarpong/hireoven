"use client"

import { AlertCircle, Check, ChevronRight, Clock, Loader2, SkipForward, X } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ScoutActiveWorkflowStep, ScoutWorkflowStepStatus } from "@/lib/scout/workflows/types"

type Props = {
  step: ScoutActiveWorkflowStep
  isLast: boolean
  onContinue: () => void
  onSkip: () => void
}

const STEP_DOT: Record<ScoutWorkflowStepStatus, React.ReactNode> = {
  pending:      <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />,
  running:      <Loader2 className="h-3 w-3 animate-spin text-[#FF5C18]" />,
  waiting_user: <Clock className="h-3 w-3 text-amber-500" />,
  completed:    <Check className="h-3 w-3 text-emerald-500" />,
  failed:       <X className="h-3 w-3 text-red-500" />,
  skipped:      <SkipForward className="h-3 w-3 text-slate-300" />,
}

const RING: Record<ScoutWorkflowStepStatus, string> = {
  pending:      "border-slate-200 bg-slate-50",
  running:      "border-[#FF5C18]/40 bg-[#FF5C18]/6 shadow-[0_0_0_3px_rgba(255,92,24,0.08)]",
  waiting_user: "border-amber-300 bg-amber-50",
  completed:    "border-emerald-200 bg-emerald-50",
  failed:       "border-red-200 bg-red-50",
  skipped:      "border-slate-100 bg-slate-50 opacity-50",
}

const TITLE: Record<ScoutWorkflowStepStatus, string> = {
  pending:      "text-slate-400",
  running:      "text-slate-900 font-semibold",
  waiting_user: "text-slate-900 font-semibold",
  completed:    "text-emerald-700 line-through decoration-emerald-300",
  failed:       "text-red-600 font-semibold",
  skipped:      "text-slate-400 line-through",
}

export function WorkflowStepRow({ step, isLast, onContinue, onSkip }: Props) {
  const { status } = step
  const isActive = status === "running" || status === "waiting_user"

  return (
    <li className="flex gap-2.5">
      {/* Spine */}
      <div className="flex flex-col items-center">
        <div className={cn("flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border transition-all", RING[status])}>
          {STEP_DOT[status]}
        </div>
        {!isLast && (
          <div className={cn("mt-0.5 w-px flex-1 min-h-[14px]", status === "completed" ? "bg-emerald-200" : "bg-slate-100")} />
        )}
      </div>

      {/* Content */}
      <div className={cn("flex-1 min-w-0", isLast ? "pb-0" : "pb-3.5")}>
        <p className={cn("text-[12px] leading-5 transition-colors", TITLE[status])}>
          {step.title}
        </p>

        {step.description && isActive && (
          <p className="mt-0.5 text-[11px] leading-4 text-slate-500">{step.description}</p>
        )}

        {/* Action row for active steps */}
        {isActive && (
          <div className="mt-1.5 flex items-center gap-2">
            {status === "waiting_user" ? (
              <button
                type="button"
                onClick={onContinue}
                className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800 transition hover:bg-amber-100"
              >
                <ChevronRight className="h-3 w-3" />
                Continue
              </button>
            ) : (
              <button
                type="button"
                onClick={onContinue}
                className="inline-flex items-center gap-1 rounded-full border border-[#FF5C18]/30 bg-[#FF5C18]/6 px-2.5 py-0.5 text-[11px] font-semibold text-[#FF5C18] transition hover:bg-[#FF5C18]/12"
              >
                <Check className="h-3 w-3" />
                Done
              </button>
            )}
            <button
              type="button"
              onClick={onSkip}
              className="text-[11px] text-slate-400 transition hover:text-slate-600"
            >
              Skip
            </button>
          </div>
        )}

        {/* Retry hint for failed */}
        {status === "failed" && (
          <div className="mt-1 flex items-center gap-1 text-[11px] text-red-500">
            <AlertCircle className="h-3 w-3 flex-shrink-0" />
            Step failed — skip or retry
          </div>
        )}
      </div>
    </li>
  )
}
