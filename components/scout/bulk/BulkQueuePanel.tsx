"use client"

import { Ban, CheckCircle2, Sparkles, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { getQueueSummary, type BulkApplicationQueue } from "@/lib/scout/bulk-application/types"
import { BulkJobRow } from "./BulkJobRow"
import type { BulkEngineActions } from "@/lib/scout/bulk-application/engine"

type Props = Pick<
  BulkEngineActions,
  "queue" | "retryJob" | "skipJob" | "markSubmitted" | "cancelQueue" | "openReview"
> & {
  onOpenApp: (applyUrl: string, queueId: string) => void
}

function StatChip({ label, value, accent }: { label: string; value: number; accent?: string }) {
  if (value === 0) return null
  return (
    <div className={cn("rounded-lg px-3 py-1.5 text-center", accent ?? "bg-slate-100")}>
      <p className="text-base font-bold text-slate-900">{value}</p>
      <p className="text-[10px] font-semibold text-slate-500">{label}</p>
    </div>
  )
}

export function BulkQueuePanel({
  queue,
  retryJob,
  skipJob,
  markSubmitted,
  cancelQueue,
  openReview,
  onOpenApp,
}: Props) {
  if (!queue) return null

  const s = getQueueSummary(queue.jobs)
  const isComplete = Boolean(queue.completedAt)
  const progressPct = s.total > 0
    ? Math.round(((s.ready + s.needsReview + s.failed + s.skipped + s.submitted) / s.total) * 100)
    : 0

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">

      {/* Header */}
      <div className={cn(
        "flex items-center gap-3 border-b px-4 py-3.5",
        isComplete ? "border-emerald-100 bg-emerald-50/60" : "border-slate-100 bg-white",
      )}>
        <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg bg-[#FF5C18] shadow-[0_2px_6px_rgba(255,92,24,0.4)]">
          <Sparkles className="h-3 w-3 text-white" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-slate-900">{queue.title}</p>
          <p className="text-[10px] text-slate-500">
            {isComplete
              ? "Preparation complete — review and submit each application"
              : `Preparing ${s.preparing > 0 ? `${s.preparing} active` : ""}…`}
          </p>
        </div>
        <button
          type="button"
          onClick={cancelQueue}
          title="Cancel bulk queue"
          className="flex-shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-500"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Progress bar */}
      <div className="h-0.5 w-full bg-slate-100">
        <div
          className={cn("h-full transition-all duration-500", isComplete ? "bg-emerald-400" : "bg-[#FF5C18]")}
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {/* Summary stats */}
      <div className="flex items-center gap-2 overflow-x-auto px-4 py-3">
        <StatChip label="Total"    value={s.total} />
        <StatChip label="Ready"    value={s.ready}       accent="bg-emerald-50 text-emerald-700" />
        <StatChip label="Review"   value={s.needsReview} accent="bg-amber-50 text-amber-700" />
        <StatChip label="Failed"   value={s.failed}      accent="bg-red-50 text-red-700" />
        <StatChip label="Skipped"  value={s.skipped} />
        <StatChip label="Submitted"value={s.submitted}   accent="bg-blue-50 text-blue-700" />
      </div>

      {/* Job rows */}
      <div className="border-t border-slate-100">
        {queue.jobs.map((job) => (
          <BulkJobRow
            key={job.queueId}
            job={job}
            onOpenReview={openReview}
            onOpenApp={onOpenApp}
            onSkip={skipJob}
            onRetry={retryJob}
            onMarkSubmitted={markSubmitted}
          />
        ))}
      </div>

      {/* Safety footer */}
      <div className="border-t border-slate-100 px-4 py-2.5">
        <p className="flex items-center gap-1.5 text-[10px] text-slate-400">
          <Ban className="h-3 w-3 flex-shrink-0" />
          Nothing submits automatically. You review and submit each application.
        </p>
      </div>
    </div>
  )
}
