"use client"

import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  FileText,
  Send,
  SkipForward,
  X,
  XCircle,
  Zap,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { BULK_FAIL_LABELS, type BulkJobItem, type BulkArtifactStatus } from "@/lib/scout/bulk-application/types"

function ArtifactRow({
  label,
  status,
  link,
  linkLabel,
}: {
  label:     string
  status:    BulkArtifactStatus
  link?:     string
  linkLabel?: string
}) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <div className="flex items-center gap-2.5">
        <span
          className={cn(
            "h-2 w-2 flex-shrink-0 rounded-full",
            status === "ready"   && "bg-emerald-500",
            status === "failed"  && "bg-red-400",
            status === "skipped" && "bg-slate-300",
            status === "pending" && "bg-slate-200",
          )}
        />
        <span className="text-sm font-medium text-slate-700">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "text-xs font-semibold",
            status === "ready"   && "text-emerald-600",
            status === "failed"  && "text-red-500",
            status === "skipped" && "text-slate-400",
            status === "pending" && "text-slate-400",
          )}
        >
          {status === "ready" ? "Ready" : status === "failed" ? "Failed" : status === "skipped" ? "Skipped" : "Pending"}
        </span>
        {link && status === "ready" && (
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-600 transition hover:border-slate-950 hover:bg-slate-950 hover:text-white"
          >
            {linkLabel ?? "Open"}
            <ChevronRight className="h-3 w-3" />
          </a>
        )}
      </div>
    </div>
  )
}

type Props = {
  job:            BulkJobItem
  onClose:        () => void
  onOpenApp:      (applyUrl: string, queueId: string) => void
  onMarkSubmitted:(queueId: string) => void
  onSkip:         (queueId: string) => void
}

export function BulkReviewDrawer({ job, onClose, onOpenApp, onMarkSubmitted, onSkip }: Props) {
  const hasWarnings = job.warnings.length > 0
  const coverLetterUrl = job.artifacts.coverLetterId
    ? `/dashboard/cover-letters?highlight=${job.artifacts.coverLetterId}`
    : undefined
  const resumeTailorUrl = job.artifacts.resumeTailorJobId
    ? `/dashboard/resume/tailor?analysisId=${job.artifacts.resumeTailorJobId}`
    : undefined

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end">
      {/* Backdrop */}
      <button
        type="button"
        onClick={onClose}
        className="absolute inset-0 bg-black/20 backdrop-blur-[2px]"
        aria-label="Close review"
      />

      {/* Drawer */}
      <div className="relative z-10 flex h-full w-full max-w-sm flex-col border-l border-slate-200 bg-white shadow-2xl">

        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">Review</p>
            <p className="mt-0.5 truncate text-base font-bold text-slate-900">{job.jobTitle}</p>
            {job.company && (
              <p className="text-xs text-slate-500">{job.company}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-3 flex-shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">

          {/* Artifacts */}
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
              Preparation status
            </p>
            <div className="divide-y divide-slate-100 rounded-xl border border-slate-100">
              <div className="px-4">
                <ArtifactRow
                  label="Tailored resume"
                  status={job.artifacts.resumeTailorStatus}
                  link={resumeTailorUrl}
                  linkLabel="Review"
                />
              </div>
              <div className="px-4">
                <ArtifactRow
                  label="Cover letter"
                  status={job.artifacts.coverLetterStatus}
                  link={coverLetterUrl}
                  linkLabel="Review"
                />
              </div>
              <div className="px-4">
                <ArtifactRow
                  label="Autofill profile"
                  status={job.artifacts.autofillStatus}
                  link={job.artifacts.autofillStatus === "ready" ? "/dashboard/autofill" : undefined}
                  linkLabel="Check"
                />
              </div>
            </div>
          </div>

          {/* Warnings */}
          {hasWarnings && (
            <div className="mt-4">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                Warnings
              </p>
              <ul className="space-y-2">
                {job.warnings.map((w) => (
                  <li
                    key={w.code}
                    className={cn(
                      "flex items-start gap-2 rounded-lg px-3.5 py-2.5 text-xs",
                      w.severity === "error"   && "bg-red-50 text-red-700",
                      w.severity === "warning" && "bg-amber-50 text-amber-800",
                      w.severity === "info"    && "bg-slate-50 text-slate-600",
                    )}
                  >
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                    <span className="leading-5">{w.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Fail reason */}
          {job.failReason && (
            <div className="mt-4 flex items-start gap-2 rounded-lg bg-red-50 px-3.5 py-3 text-xs text-red-700">
              <XCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
              <span>{BULK_FAIL_LABELS[job.failReason]}</span>
            </div>
          )}

          {/* Match score */}
          {typeof job.matchScore === "number" && (
            <div className="mt-4 flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
              <span className="text-xs font-semibold text-slate-600">Match score</span>
              <span
                className={cn(
                  "text-sm font-bold",
                  job.matchScore >= 80 ? "text-emerald-600" : job.matchScore >= 60 ? "text-amber-600" : "text-slate-600",
                )}
              >
                {job.matchScore}%
              </span>
            </div>
          )}

          {/* Safety note */}
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3.5 py-3">
            <Ban className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-slate-400" />
            <p className="text-[11px] leading-5 text-slate-500">
              Scout never auto-submits. Attachments, cover letters, and sensitive fields require your explicit approval.
            </p>
          </div>
        </div>

        {/* Footer actions */}
        <div className="space-y-2 border-t border-slate-100 px-5 py-4">
          {job.applyUrl && (
            <button
              type="button"
              onClick={() => onOpenApp(job.applyUrl!, job.queueId)}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              <ExternalLink className="h-4 w-4" />
              Open application
            </button>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => { onMarkSubmitted(job.queueId); onClose() }}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              <Send className="h-3 w-3" />
              Mark submitted
            </button>
            <button
              type="button"
              onClick={() => { onSkip(job.queueId); onClose() }}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 py-2 text-xs font-semibold text-slate-500 transition hover:bg-slate-50"
            >
              <SkipForward className="h-3 w-3" />
              Skip
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
