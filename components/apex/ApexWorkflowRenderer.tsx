"use client"

import { useState } from "react"
import { Check, Lock, Zap } from "lucide-react"
import { useFeatureAccess } from "@/lib/hooks/useFeatureAccess"
import { useUpgradeModal } from "@/lib/context/UpgradeModalContext"
import { getDefaultActionLabel } from "@/lib/scout/actions"
import type { ScoutWorkflow } from "@/lib/scout/types"
import { useScoutActionExecutor } from "./useScoutActionExecutor"

type ScoutWorkflowRendererProps = {
  workflow: ScoutWorkflow
}

export function ScoutWorkflowRenderer({ workflow }: ScoutWorkflowRendererProps) {
  const [completedSteps, setCompletedSteps] = useState<Set<string>>(new Set())
  const { hasAccess: canExecuteAllSteps } = useFeatureAccess("scout_strategy")
  const { showUpgrade } = useUpgradeModal()
  const { executeAction, feedback } = useScoutActionExecutor()

  if (!workflow.steps.length) return null

  function markComplete(stepId: string) {
    setCompletedSteps((prev) => new Set(prev).add(stepId))
  }

  const totalSteps = workflow.steps.length
  const doneCount = completedSteps.size
  const progressPct = totalSteps > 0 ? Math.round((doneCount / totalSteps) * 100) : 0

  return (
    <div className="mt-5 space-y-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Guided Workflow</p>

      <div className="overflow-hidden rounded-[18px] border border-slate-200/80 bg-white shadow-[0_2px_16px_rgba(15,23,42,0.06)]">
        {/* Header */}
        <div className="border-b border-slate-100 px-5 py-4">
          <div className="flex items-center justify-between gap-4">
            <h4 className="text-sm font-semibold text-slate-900">{workflow.title}</h4>
            <span className="flex-shrink-0 text-[11px] font-semibold text-slate-400">
              {doneCount}/{totalSteps} done
            </span>
          </div>
          {/* Progress bar */}
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-blue-500 transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>

        {/* Steps */}
        <ol className="divide-y divide-slate-100">
          {workflow.steps.map((step, index) => {
            const isCompleted = completedSteps.has(step.id)
            const isLocked = !canExecuteAllSteps && index > 0
            const isActive = !isCompleted && !isLocked
            const action = step.action

            return (
              <li
                key={step.id}
                className={`flex items-start gap-4 px-5 py-4 transition-colors ${
                  isCompleted ? "bg-emerald-50/60" : isLocked ? "bg-slate-50/80" : "bg-white"
                }`}
              >
                {/* Step indicator */}
                <div className="relative flex flex-shrink-0 flex-col items-center">
                  <div
                    className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ring-2 transition-all ${
                      isCompleted
                        ? "bg-emerald-500 text-white ring-emerald-500"
                        : isLocked
                          ? "bg-slate-100 text-slate-400 ring-slate-200"
                          : "bg-blue-500 text-white ring-blue-500"
                    }`}
                  >
                    {isCompleted ? <Check className="h-3.5 w-3.5" /> : index + 1}
                  </div>
                  {/* Connector line */}
                  {index < totalSteps - 1 && (
                    <div
                      className={`mt-1 h-full min-h-[16px] w-0.5 rounded-full ${
                        isCompleted ? "bg-emerald-300" : "bg-slate-200"
                      }`}
                    />
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0 pb-1">
                  <div className="flex items-start gap-2">
                    <p
                      className={`text-sm font-semibold leading-5 ${
                        isCompleted ? "text-emerald-700 line-through" : isLocked ? "text-slate-400" : "text-slate-900"
                      }`}
                    >
                      {step.title}
                    </p>
                    {isLocked && (
                      <Lock className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-slate-400" />
                    )}
                  </div>
                  {step.description && (
                    <p className={`mt-0.5 text-xs leading-5 ${isLocked ? "text-slate-400" : "text-slate-500"}`}>
                      {step.description}
                    </p>
                  )}

                  {/* Action button */}
                  <div className="mt-2">
                    {action ? (
                      <button
                        type="button"
                        onClick={() => {
                          if (isLocked) {
                            showUpgrade("scout_strategy")
                            return
                          }
                          executeAction(action, { onExecuted: () => markComplete(step.id) })
                        }}
                        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition ${
                          isCompleted
                            ? "border-emerald-200 bg-white text-emerald-600 opacity-60 cursor-default"
                            : isLocked
                              ? "border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100"
                              : "border-blue-200 bg-blue-50 text-blue-700 hover:border-blue-300 hover:bg-blue-100"
                        }`}
                        disabled={isCompleted}
                      >
                        {isLocked ? (
                          <>
                            <Zap className="h-3 w-3" />
                            Unlock step
                          </>
                        ) : (
                          action.label || getDefaultActionLabel(action)
                        )}
                      </button>
                    ) : !isCompleted && isActive ? (
                      <button
                        type="button"
                        onClick={() => markComplete(step.id)}
                        className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600 transition hover:border-emerald-300 hover:text-emerald-700"
                      >
                        <Check className="h-3 w-3" />
                        Mark done
                      </button>
                    ) : null}
                  </div>
                </div>
              </li>
            )
          })}
        </ol>

        {/* Free plan nudge */}
        {!canExecuteAllSteps && totalSteps > 1 && (
          <div className="border-t border-amber-100 bg-amber-50 px-5 py-3">
            <p className="text-xs text-amber-800">
              Free plan: step 1 only.{" "}
              <button
                type="button"
                onClick={() => showUpgrade("scout_strategy")}
                className="font-semibold underline underline-offset-2"
              >
                Upgrade
              </button>{" "}
              to run all steps.
            </p>
          </div>
        )}
      </div>

      {feedback && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">
          {feedback}
        </div>
      )}
    </div>
  )
}
