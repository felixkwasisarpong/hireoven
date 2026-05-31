"use client"

import { useState } from "react"
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import type { TestRunResult } from "@/lib/apex/interview/codingRunner"

type Props = {
  result: TestRunResult | null
  isRunning: boolean
  onRun: () => void
  onSubmit: () => void
  sessionCompleted?: boolean
}

export default function TestConsole({ result, isRunning, onRun, onSubmit, sessionCompleted }: Props) {
  const [expanded, setExpanded] = useState(false)

  const pct = result && result.totalWeight > 0
    ? Math.round((result.passed / result.totalWeight) * 100)
    : null

  return (
    <div className="flex flex-col gap-2">
      {/* Run + Submit buttons */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onRun}
          disabled={isRunning || sessionCompleted}
          className="flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-1.5 text-[12px] font-semibold text-white transition hover:bg-slate-700 disabled:opacity-50"
        >
          {isRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          {isRunning ? "Running…" : "Run"}
        </button>

        <button
          type="button"
          onClick={onSubmit}
          disabled={isRunning || sessionCompleted}
          className="flex items-center gap-1.5 rounded-lg border border-orange-200 bg-orange-50 px-3 py-1.5 text-[12px] font-semibold text-orange-700 transition hover:bg-orange-100 disabled:opacity-50"
        >
          Submit final solution
        </button>

        {result && pct !== null && (
          <span className={cn(
            "ml-auto text-[12px] font-semibold",
            pct === 100 ? "text-emerald-600" : pct >= 50 ? "text-amber-600" : "text-red-500"
          )}>
            {result.passedCount}/{result.passedCount + result.failedCount} tests · {pct}%
          </span>
        )}
      </div>

      {/* Results */}
      {result && (
        <div className="rounded-lg border border-slate-200 bg-slate-900 p-3">
          <div className="flex items-center gap-2">
            <div className="flex gap-1">
              {Array.from({ length: result.passedCount + result.failedCount }, (_, i) => {
                const errorIdx = result.errors.findIndex((e) => e.testIdx === i)
                const passed = errorIdx === -1
                return (
                  <span
                    key={i}
                    className={cn(
                      "inline-flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold",
                      passed ? "bg-emerald-500 text-white" : "bg-red-500 text-white"
                    )}
                  >
                    {passed ? "✓" : "✗"}
                  </span>
                )
              })}
            </div>

            {result.errors.length > 0 && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="ml-auto flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200"
              >
                {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                {expanded ? "Hide" : "Details"}
              </button>
            )}
          </div>

          {expanded && result.errors.length > 0 && (
            <div className="mt-2 space-y-2 border-t border-slate-700 pt-2">
              {result.errors.slice(0, 5).map((err) => (
                <div key={err.testIdx} className="rounded bg-slate-800 p-2 text-[11px] font-mono">
                  <p className="text-red-400">Test {err.testIdx + 1}: {err.error.slice(0, 120)}</p>
                  <p className="text-slate-500">Expected: {JSON.stringify(err.expected)}</p>
                  {err.got !== null && (
                    <p className="text-slate-500">Got: {JSON.stringify(err.got)}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          {result.runtimeMs > 0 && (
            <p className="mt-1.5 text-[10px] text-slate-500">{result.runtimeMs}ms</p>
          )}
        </div>
      )}
    </div>
  )
}
