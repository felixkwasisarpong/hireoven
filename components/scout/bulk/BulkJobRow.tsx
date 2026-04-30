"use client"

import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Clock,
  ExternalLink,
  FileText,
  Loader2,
  Send,
  SkipForward,
  XCircle,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { BULK_FAIL_LABELS, type BulkJobItem } from "@/lib/scout/bulk-application/types"

const STATUS_CONFIG = {
  pending:      { label: "Queued",      icon: Circle,       color: "text-slate-400" },
  preparing:    { label: "Preparing…",  icon: Loader2,      color: "text-blue-500" },
  ready:        { label: "Ready",       icon: CheckCircle2, color: "text-emerald-500" },
  needs_review: { label: "Needs review",icon: AlertTriangle,color: "text-amber-500" },
  failed:       { label: "Failed",      icon: XCircle,      color: "text-red-500" },
  skipped:      { label: "Skipped",     icon: SkipForward,  color: "text-slate-400" },
  submitted:    { label: "Submitted",   icon: Send,         color: "text-blue-600" },
}

type Props = {
  job:            BulkJobItem
  onOpenReview:   (queueId: string) => void
  onOpenApp:      (applyUrl: string, queueId: string) => void
  onSkip:         (queueId: string) => void
  onRetry:        (queueId: string) => void
  onMarkSubmitted:(queueId: string) => void
}

export function BulkJobRow({ job, onOpenReview, onOpenApp, onSkip, onRetry, onMarkSubmitted }: Props) {
  const cfg = STATUS_CONFIG[job.status]
  const Icon = cfg.icon
  const isSpinning = job.status === "preparing"

  const artifactBadges = [
    { label: "Resume", status: job.artifacts.resumeTailorStatus },
    { label: "Cover",  status: job.artifacts.coverLetterStatus },
    { label: "Fill",   status: job.artifacts.autofillStatus },
  ] as const

  return (
    <div
      className={cn(
        "flex items-center gap-3 border-b border-slate-100 px-4 py-3 last:border-0",
        job.status === "submitted" && "opacity-60",
        job.status === "skipped"   && "opacity-50",
      )}
    >
      {/* Status icon */}
      <span className={cn("flex-shrink-0", cfg.color)}>
        <Icon className={cn("h-4 w-4", isSpinning && "animate-spin")} />
      </span>

      {/* Title + company */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-slate-800">{job.jobTitle}</p>
        {job.company && (
          <p className="text-xs text-slate-400">{job.company}</p>
        )}
      </div>

      {/* Match score */}
      {typeof job.matchScore === "number" && (
        <span className="hidden flex-shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 sm:inline">
          {job.matchScore}%
        </span>
      )}

      {/* Artifact status badges */}
      <div className="hidden items-center gap-1 sm:flex">
        {artifactBadges.map(({ label, status }) => (
          <span
            key={label}
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px] font-semibold",
              status === "ready"   && "bg-emerald-50 text-emerald-700",
              status === "failed"  && "bg-red-50 text-red-600",
              status === "skipped" && "bg-slate-50 text-slate-400",
              status === "pending" && "bg-slate-50 text-slate-400",
            )}
          >
            {label}
          </span>
        ))}
      </div>

      {/* Warnings badge */}
      {job.warnings.length > 0 && (
        <span className="flex-shrink-0" title={job.warnings.map((w) => w.message).join("\n")}>
          <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
        </span>
      )}

      {/* Fail reason */}
      {job.failReason && (
        <span className="hidden text-[10px] text-red-500 sm:inline">
          {BULK_FAIL_LABELS[job.failReason]}
        </span>
      )}

      {/* Actions */}
      <div className="flex flex-shrink-0 items-center gap-1">
        {(job.status === "ready" || job.status === "needs_review") && (
          <>
            <button
              type="button"
              onClick={() => onOpenReview(job.queueId)}
              className="rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-700 transition hover:border-slate-950 hover:bg-slate-950 hover:text-white"
            >
              Review
            </button>
            {job.applyUrl && (
              <button
                type="button"
                onClick={() => onOpenApp(job.applyUrl!, job.queueId)}
                title="Open application page"
                className="rounded-lg border border-slate-200 p-1.5 text-slate-500 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </button>
            )}
          </>
        )}

        {job.status === "failed" && (
          <button
            type="button"
            onClick={() => onRetry(job.queueId)}
            className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-semibold text-red-700 transition hover:bg-red-100"
          >
            Retry
          </button>
        )}

        {job.status === "submitted" && (
          <span className="flex items-center gap-1 text-[11px] font-semibold text-blue-600">
            <CheckCircle2 className="h-3 w-3" />
            Done
          </span>
        )}

        {["pending", "preparing", "ready", "needs_review"].includes(job.status) && (
          <button
            type="button"
            onClick={() => onSkip(job.queueId)}
            title="Skip this job"
            className="rounded-lg p-1.5 text-slate-300 transition hover:bg-slate-50 hover:text-slate-500"
          >
            <SkipForward className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}
