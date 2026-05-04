"use client"

import { AlertTriangle, Layers, Loader2 } from "lucide-react"
import { BulkQueuePanel } from "@/components/scout/bulk/BulkQueuePanel"
import type { BulkEngineActions } from "@/lib/scout/bulk-application/engine"

type Props = {
  engine:     BulkEngineActions
  onFollowUp: (query: string) => void
  onOpenApp:  (applyUrl: string, queueId: string) => void
}

export function BulkApplicationMode({ engine, onFollowUp, onOpenApp }: Props) {
  return (
    <div className="space-y-5">

      {/* Mode header */}
      <div className="flex items-center gap-2.5">
        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-slate-950">
          <Layers className="h-3.5 w-3.5 text-white" />
        </div>
        <p className="text-sm font-semibold text-gray-900">Bulk application queue</p>
      </div>

      {/* Loading */}
      {engine.initState === "loading" && (
        <div className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50 px-4 py-5">
          <Loader2 className="h-4 w-4 animate-spin flex-shrink-0 text-[#FF5C18]" />
          <p className="text-sm text-slate-600">
            Loading your saved jobs and selecting the best matches…
          </p>
        </div>
      )}

      {/* Error */}
      {engine.initState === "error" && engine.initError && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-4">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500" />
            <div>
              <p className="text-sm font-semibold text-red-700">{engine.initError}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {[
                  "Show my saved jobs",
                  "Find remote backend jobs to save",
                  "Find visa-friendly roles",
                ].map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => onFollowUp(chip)}
                    className="rounded-full border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 transition hover:bg-red-100"
                  >
                    {chip}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Active queue */}
      {engine.queue && (
        <BulkQueuePanel
          queue={engine.queue}
          retryJob={engine.retryJob}
          skipJob={engine.skipJob}
          markSubmitted={engine.markSubmitted}
          cancelQueue={engine.cancelQueue}
          openReview={engine.openReview}
          onOpenApp={onOpenApp}
        />
      )}

      {/* Follow-up chips */}
      {(engine.queue || engine.initState === "done") && (
        <div className="flex flex-wrap gap-2">
          {[
            "What should I apply to next?",
            "Skip failed jobs and retry",
            "How do I improve my match scores?",
          ].map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => onFollowUp(chip)}
              className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-500 transition hover:border-slate-950 hover:bg-slate-950 hover:text-white"
            >
              {chip}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
