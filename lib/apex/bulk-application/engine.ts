"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { BulkApplicationQueue, BulkJobItem, BulkJobStatus, BulkFailReason, BulkJobArtifacts, BulkJobWarning } from "./types"
import { readBulkQueue, writeBulkQueue, clearBulkQueue } from "./store"
import type { BulkSelectionOptions } from "./selector"
import type { ApplyAgentJob } from "@/lib/scout/apply-agent/types"

const MAX_CONCURRENT = 2

function makeQueueId(): string {
  return `bq-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

type BulkPrepareResponse = {
  resumeTailorStatus?:  string
  resumeTailorJobId?:   string
  coverLetterStatus?:   string
  coverLetterId?:       string
  autofillStatus?:      string
  warnings?:            BulkJobWarning[]
  failReason?:          BulkFailReason
  error?:               string
}

export type BulkInitState = "idle" | "loading" | "done" | "error"

export type BulkEngineActions = {
  queue:            BulkApplicationQueue | null
  initState:        BulkInitState
  initError:        string | null
  /** Shell calls this when it detects a bulk prep directive from Scout. */
  initQueue:        (opts: import("./selector").BulkSelectionOptions) => Promise<void>
  isConfirming:     boolean
  confirmJobs:      BulkJobItem[]
  requestBulk:      (jobs: BulkJobItem[]) => void
  confirmStart:     () => void
  cancelConfirm:    () => void
  retryJob:         (queueId: string) => void
  skipJob:          (queueId: string) => void
  markSubmitted:    (queueId: string) => void
  cancelQueue:      () => void
  reviewingQueueId: string | null
  openReview:       (queueId: string) => void
  closeReview:      () => void
}

export function useBulkApplicationEngine(): BulkEngineActions {
  const [queue,            setQueue]            = useState<BulkApplicationQueue | null>(null)
  const [initState,        setInitState]        = useState<BulkInitState>("idle")
  const [initError,        setInitError]        = useState<string | null>(null)
  const [isConfirming,     setIsConfirming]     = useState(false)
  const [confirmJobs,      setConfirmJobs]      = useState<BulkJobItem[]>([])
  const [reviewingQueueId, setReviewingQueueId] = useState<string | null>(null)
  const hasMounted = useRef(false)
  // Tracks which queueIds are actively being fetched to prevent double-dispatch
  const inFlightRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (hasMounted.current) return
    hasMounted.current = true
    const saved = readBulkQueue()
    if (saved && !saved.cancelledAt && !saved.completedAt) setQueue(saved)
  }, [])

  useEffect(() => {
    if (!hasMounted.current) return
    if (queue) writeBulkQueue(queue)
    else clearBulkQueue()
  }, [queue])

  const patchJob = useCallback((queueId: string, patch: Partial<BulkJobItem>) => {
    setQueue((prev) => {
      if (!prev) return prev
      return { ...prev, jobs: prev.jobs.map((j) => j.queueId === queueId ? { ...j, ...patch } : j) }
    })
  }, [])

  const prepareOne = useCallback(async (job: BulkJobItem) => {
    if (inFlightRef.current.has(job.queueId)) return
    inFlightRef.current.add(job.queueId)

    patchJob(job.queueId, { status: "preparing" })

    try {
      const res = await fetch("/api/scout/bulk-prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId:             job.jobId,
          jobTitle:          job.jobTitle,
          company:           job.company,
          applyUrl:          job.applyUrl,
          sponsorshipSignal: job.sponsorshipSignal,
        }),
      })

      const data = (await res.json().catch(() => null)) as BulkPrepareResponse | null

      if (!res.ok || !data || data.failReason) {
        patchJob(job.queueId, { status: "failed", failReason: data?.failReason ?? "network_error" })
        return
      }

      const artifacts: BulkJobArtifacts = {
        resumeTailorStatus: (data.resumeTailorStatus ?? "failed") as BulkJobArtifacts["resumeTailorStatus"],
        resumeTailorJobId:  data.resumeTailorJobId,
        coverLetterStatus:  (data.coverLetterStatus  ?? "failed") as BulkJobArtifacts["coverLetterStatus"],
        coverLetterId:      data.coverLetterId,
        autofillStatus:     (data.autofillStatus     ?? "ready")  as BulkJobArtifacts["autofillStatus"],
      }

      const warnings: BulkJobWarning[] = data.warnings ?? []
      const hasBlocker = warnings.some((w) => w.severity === "error")
      const hasWarning = warnings.some((w) => w.severity === "warning")

      patchJob(job.queueId, {
        status:      hasBlocker ? "needs_review" : hasWarning ? "needs_review" : "ready",
        artifacts,
        warnings,
        preparedAt:  new Date().toISOString(),
      })
    } catch {
      patchJob(job.queueId, { status: "failed", failReason: "network_error" })
    } finally {
      inFlightRef.current.delete(job.queueId)
    }
  }, [patchJob])

  // Rate-limited runner: fire pending jobs up to MAX_CONCURRENT slots
  useEffect(() => {
    if (!queue || queue.cancelledAt || queue.completedAt) return

    const activeCount = queue.jobs.filter((j) => j.status === "preparing").length
    const slots = MAX_CONCURRENT - activeCount
    if (slots <= 0) return

    let started = 0
    for (const job of queue.jobs) {
      if (started >= slots) break
      if (job.status === "pending" && !inFlightRef.current.has(job.queueId)) {
        started++
        void prepareOne(job)
      }
    }

    const allSettled = queue.jobs.every((j) =>
      ["ready", "needs_review", "failed", "skipped", "submitted"].includes(j.status)
    )
    if (allSettled && queue.jobs.length > 0 && !queue.completedAt) {
      setQueue((prev) => prev ? { ...prev, completedAt: new Date().toISOString() } : prev)
    }
  }, [queue, prepareOne])

  const initQueue = useCallback(async (opts: BulkSelectionOptions) => {
    // If queue is already active or confirming, don't clobber it
    setQueue((q) => {
      if (q && !q.cancelledAt && !q.completedAt) return q
      return q
    })
    setInitState("loading")
    setInitError(null)

    try {
      const params = new URLSearchParams()
      params.set("count", String(typeof opts.count === "number" ? opts.count : 10))
      if (typeof opts.minMatchScore === "number") params.set("minMatchScore", String(opts.minMatchScore))
      if (opts.requireSponsorshipSignal) params.set("sponsorship", "true")
      if (typeof opts.workMode === "string" && opts.workMode.length > 0) params.set("workMode", opts.workMode)
      if (opts.strictScoreOnly) params.set("strictScoreOnly", "true")

      const res = await fetch(`/api/scout/apply-agent?${params.toString()}`, {
        headers: { Accept: "application/json" },
      })
      if (!res.ok) throw new Error("Could not load feed matches")

      const data = (await res.json().catch(() => null)) as { jobs?: ApplyAgentJob[] } | null
      const selected: BulkJobItem[] = (data?.jobs ?? []).map((j) => ({
        queueId:           `bj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        jobId:             j.jobId,
        jobTitle:          j.jobTitle,
        company:           j.company ?? undefined,
        applyUrl:          j.applyUrl ?? undefined,
        matchScore:        j.matchScore,
        sponsorshipSignal: j.sponsorshipSignal,
        ghostRisk:         undefined,
        status:            "pending" as const,
        artifacts: {
          resumeTailorStatus: "pending",
          coverLetterStatus:  "pending",
          autofillStatus:     "pending",
        },
        warnings: [],
        addedAt: new Date().toISOString(),
      }))

      if (selected.length === 0) {
        setInitState("error")
        setInitError("No eligible feed jobs matched the criteria. Try relaxing filters or lowering the match threshold.")
        return
      }

      setConfirmJobs(selected)
      setIsConfirming(true)
      setInitState("done")
    } catch (err) {
      setInitState("error")
      setInitError(err instanceof Error ? err.message : "Could not load feed matches")
    }
  }, [])

  const requestBulk = useCallback((jobs: BulkJobItem[]) => {
    setConfirmJobs(jobs)
    setIsConfirming(true)
  }, [])

  const confirmStart = useCallback(() => {
    setQueue({
      id:        makeQueueId(),
      title:     `Bulk preparation — ${confirmJobs.length} job${confirmJobs.length !== 1 ? "s" : ""}`,
      createdAt: new Date().toISOString(),
      jobs:      confirmJobs,
    })
    setIsConfirming(false)
    setConfirmJobs([])
  }, [confirmJobs])

  const cancelConfirm = useCallback(() => {
    setIsConfirming(false)
    setConfirmJobs([])
  }, [])

  const retryJob = useCallback((queueId: string) => {
    setQueue((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        completedAt: undefined,
        jobs: prev.jobs.map((j) =>
          j.queueId === queueId
            ? { ...j, status: "pending" as BulkJobStatus, failReason: undefined, artifacts: { resumeTailorStatus: "pending", coverLetterStatus: "pending", autofillStatus: "pending" }, warnings: [] }
            : j
        ),
      }
    })
  }, [])

  const skipJob     = useCallback((queueId: string) => patchJob(queueId, { status: "skipped" }), [patchJob])
  const markSubmitted = useCallback((queueId: string) => patchJob(queueId, { status: "submitted" }), [patchJob])

  const cancelQueue = useCallback(() => {
    inFlightRef.current.clear()
    setQueue((prev) => prev ? { ...prev, cancelledAt: new Date().toISOString() } : prev)
    setTimeout(() => setQueue(null), 300)
  }, [])

  const openReview  = useCallback((queueId: string) => setReviewingQueueId(queueId), [])
  const closeReview = useCallback(() => setReviewingQueueId(null), [])

  return {
    queue, initState, initError,
    initQueue, isConfirming, confirmJobs,
    requestBulk, confirmStart, cancelConfirm,
    retryJob, skipJob, markSubmitted, cancelQueue,
    reviewingQueueId, openReview, closeReview,
  }
}
