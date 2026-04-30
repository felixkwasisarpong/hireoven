"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { AlertTriangle, Layers, Loader2 } from "lucide-react"
import { BulkQueuePanel } from "@/components/scout/bulk/BulkQueuePanel"
import { BulkConfirmDialog } from "@/components/scout/bulk/BulkConfirmDialog"
import { BulkReviewDrawer } from "@/components/scout/bulk/BulkReviewDrawer"
import { selectJobsForBulk, type BulkJobCandidate, type BulkSelectionOptions } from "@/lib/scout/bulk-application/selector"
import type { BulkEngineActions } from "@/lib/scout/bulk-application/engine"

type Props = {
  engine:  BulkEngineActions
  payload: BulkModePayload
  onFollowUp: (query: string) => void
}

export type BulkModePayload = {
  count?:                  number
  requireSponsorshipSignal?: boolean
  workMode?:               string
  minMatchScore?:          number
}

type SavedApplication = {
  id:                string
  job_id?:           string | null
  job_title?:        string | null
  company_name?:     string | null
  apply_url?:        string | null
  status?:           string | null
  match_score?:      number | null
  sponsorship_signal?: string | null
  ghost_risk?:       string | null
}

export function BulkApplicationMode({ engine, payload, onFollowUp }: Props) {
  const [fetchState, setFetchState] = useState<"idle" | "loading" | "done" | "error">("idle")
  const [fetchError, setFetchError] = useState<string | null>(null)
  const hasInitialized = useRef(false)

  const initBulkQueue = useCallback(async (opts: BulkSelectionOptions) => {
    setFetchState("loading")
    setFetchError(null)

    try {
      const res = await fetch("/api/applications?status=saved&limit=100", {
        headers: { Accept: "application/json" },
      })
      if (!res.ok) throw new Error("Could not load saved applications")

      const data = (await res.json().catch(() => null)) as { applications?: SavedApplication[] } | null
      const rows: SavedApplication[] = data?.applications ?? []

      const candidates: BulkJobCandidate[] = rows
        .filter((r) => r.job_id)
        .map((r) => ({
          jobId:             r.job_id!,
          jobTitle:          r.job_title ?? "Unknown role",
          company:           r.company_name ?? undefined,
          applyUrl:          r.apply_url,
          matchScore:        r.match_score,
          sponsorshipSignal: r.sponsorship_signal,
          ghostRisk:         r.ghost_risk as BulkJobCandidate["ghostRisk"],
          alreadyApplied:    false,
        }))

      const selected = selectJobsForBulk(candidates, opts)

      if (selected.length === 0) {
        setFetchState("error")
        setFetchError("No eligible saved jobs found. Save some jobs first, or adjust your filters.")
        return
      }

      engine.requestBulk(selected)
      setFetchState("done")
    } catch (err) {
      setFetchState("error")
      setFetchError(err instanceof Error ? err.message : "Could not load saved jobs")
    }
  }, [engine])

  // Auto-initialize when mode mounts (if no active queue yet)
  useEffect(() => {
    if (hasInitialized.current) return
    if (engine.queue || engine.isConfirming) return

    hasInitialized.current = true
    void initBulkQueue({
      count:                   payload.count ?? 10,
      requireSponsorshipSignal: payload.requireSponsorshipSignal,
      workMode:                payload.workMode,
      minMatchScore:           payload.minMatchScore,
    })
  }, [engine.queue, engine.isConfirming, initBulkQueue, payload])

  const handleOpenApp = useCallback((applyUrl: string, queueId: string) => {
    window.open(applyUrl, "_blank", "noopener,noreferrer")
  }, [])

  const reviewJob = engine.queue?.jobs.find((j) => j.queueId === engine.reviewingQueueId) ?? null

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
      {fetchState === "loading" && (
        <div className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50 px-4 py-5">
          <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
          <p className="text-sm text-slate-600">Loading your saved jobs and selecting the best matches…</p>
        </div>
      )}

      {/* Error */}
      {fetchState === "error" && fetchError && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-4">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500" />
            <div>
              <p className="text-sm font-semibold text-red-700">{fetchError}</p>
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

      {/* Queue panel — shown when queue is active */}
      {engine.queue && (
        <BulkQueuePanel
          queue={engine.queue}
          retryJob={engine.retryJob}
          skipJob={engine.skipJob}
          markSubmitted={engine.markSubmitted}
          cancelQueue={engine.cancelQueue}
          openReview={engine.openReview}
          onOpenApp={handleOpenApp}
        />
      )}

      {/* Follow-up chips */}
      {(fetchState === "done" || engine.queue) && (
        <div className="flex flex-wrap gap-2">
          {[
            "What should I apply to next?",
            "Skip failed jobs and retry queue",
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

      {/* Confirm dialog — modal overlay */}
      {engine.isConfirming && (
        <BulkConfirmDialog
          jobs={engine.confirmJobs}
          onConfirm={engine.confirmStart}
          onEditList={engine.cancelConfirm}
          onCancel={engine.cancelConfirm}
        />
      )}

      {/* Review drawer — slides in from the right */}
      {reviewJob && (
        <BulkReviewDrawer
          job={reviewJob}
          onClose={engine.closeReview}
          onOpenApp={handleOpenApp}
          onMarkSubmitted={engine.markSubmitted}
          onSkip={engine.skipJob}
        />
      )}
    </div>
  )
}
