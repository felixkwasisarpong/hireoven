"use client"

import { useCallback, useState } from "react"
import {
  Ban,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Send,
  SkipForward,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { BULK_FAIL_LABELS, type BulkJobItem } from "@/lib/scout/bulk-application/types"
import { computeReadiness } from "@/lib/scout/review/readiness"
import { logReviewEvent } from "@/lib/scout/review/audit"
import { ReviewChecklist } from "./ReviewChecklist"

type Props = {
  job:            BulkJobItem
  onClose:        () => void
  onOpenApp:      (applyUrl: string, queueId: string) => void
  onMarkSubmitted:(queueId: string) => void
  onSkip:         (queueId: string) => void
}

export function BulkReviewDrawer({ job, onClose, onOpenApp, onMarkSubmitted, onSkip }: Props) {
  const [submitting, setSubmitting] = useState(false)
  const [sensitiveAcknowledged, setSensitiveAcknowledged] = useState(false)

  const checklist = computeReadiness({
    jobId:          job.jobId,
    queueItemId:    job.queueId,
    artifacts:      job.artifacts,
    preparationWarnings: job.warnings,
    sensitiveAcknowledged,
  })

  const coverLetterUrl = job.artifacts.coverLetterId
    ? `/dashboard/cover-letters?highlight=${job.artifacts.coverLetterId}`
    : undefined
  const resumeTailorUrl = job.artifacts.resumeTailorJobId
    ? `/dashboard/resume/tailor?analysisId=${job.artifacts.resumeTailorJobId}`
    : undefined

  const handleOpenApp = useCallback(() => {
    if (!job.applyUrl) return
    logReviewEvent({
      event:        "review_opened",
      jobId:        job.jobId,
      queueItemId:  job.queueId,
      readiness:    checklist.submitReadiness,
      blockerCount: checklist.blockers.length,
      warningCount: checklist.warnings.length,
    })
    onOpenApp(job.applyUrl, job.queueId)
  }, [job, checklist, onOpenApp])

  const handleMarkSubmitted = useCallback(async () => {
    setSubmitting(true)
    try {
      await fetch("/api/scout/mark-submitted", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          jobId:       job.jobId,
          jobTitle:    job.jobTitle,
          companyName: job.company,
          applyUrl:    job.applyUrl,
        }),
      })
    } catch {}

    logReviewEvent({
      event:        "submitted_manually",
      jobId:        job.jobId,
      queueItemId:  job.queueId,
      readiness:    checklist.submitReadiness,
      blockerCount: checklist.blockers.length,
      warningCount: checklist.warnings.length,
    })

    onMarkSubmitted(job.queueId)
    onClose()
    setSubmitting(false)
  }, [job, checklist, onMarkSubmitted, onClose])

  const handleSkip = useCallback(() => {
    logReviewEvent({
      event:        "skipped",
      jobId:        job.jobId,
      queueItemId:  job.queueId,
      readiness:    checklist.submitReadiness,
      blockerCount: checklist.blockers.length,
      warningCount: checklist.warnings.length,
    })
    onSkip(job.queueId)
    onClose()
  }, [job, checklist, onSkip, onClose])

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
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">Final Review</p>
            <p className="mt-0.5 truncate text-base font-bold text-slate-900">{job.jobTitle}</p>
            {job.company && <p className="text-xs text-slate-500">{job.company}</p>}
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
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">

          {/* Readiness checklist */}
          <ReviewChecklist checklist={checklist} />

          {/* Quick links to artifacts */}
          {(resumeTailorUrl || coverLetterUrl) && (
            <div className="space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                Review materials
              </p>
              <div className="space-y-1.5">
                {resumeTailorUrl && (
                  <a
                    href={resumeTailorUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                  >
                    Review tailored resume
                    <ExternalLink className="h-3.5 w-3.5 text-slate-400" />
                  </a>
                )}
                {coverLetterUrl && (
                  <a
                    href={coverLetterUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                  >
                    Review cover letter
                    <ExternalLink className="h-3.5 w-3.5 text-slate-400" />
                  </a>
                )}
              </div>
            </div>
          )}

          {/* Sensitive fields acknowledgement */}
          {!sensitiveAcknowledged && (
            <button
              type="button"
              onClick={() => setSensitiveAcknowledged(true)}
              className="w-full rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-left text-xs text-amber-800 transition hover:bg-amber-100"
            >
              <span className="font-semibold">I have reviewed sensitive questions</span>
              <span className="block mt-0.5 text-amber-600">
                Tap to confirm you have checked sponsorship, legal, and EEO fields manually.
              </span>
            </button>
          )}
          {sensitiveAcknowledged && (
            <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
              <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-emerald-500" />
              <p className="text-xs font-semibold text-emerald-700">Sensitive fields confirmed reviewed</p>
            </div>
          )}

          {/* Match score */}
          {typeof job.matchScore === "number" && (
            <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
              <span className="text-xs font-semibold text-slate-600">Match score</span>
              <span className={cn(
                "text-sm font-bold",
                job.matchScore >= 80 ? "text-emerald-600" : job.matchScore >= 60 ? "text-amber-600" : "text-slate-600"
              )}>
                {job.matchScore}%
              </span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="space-y-2 border-t border-slate-100 px-5 py-4">
          {job.applyUrl && (
            <button
              type="button"
              onClick={handleOpenApp}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              <ExternalLink className="h-4 w-4" />
              Open application
            </button>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleMarkSubmitted}
              disabled={submitting}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
            >
              {submitting
                ? <Loader2 className="h-3 w-3 animate-spin" />
                : <Send className="h-3 w-3" />}
              Mark submitted
            </button>
            <button
              type="button"
              onClick={handleSkip}
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
