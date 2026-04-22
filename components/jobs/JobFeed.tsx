"use client"

import { useEffect, useRef, useState } from "react"
import { ArrowUp, Sparkles } from "lucide-react"
import JobCard from "@/components/jobs/JobCard"
import { H1BPredictionProvider } from "@/lib/context/H1BPredictionContext"
import { useAuth } from "@/lib/hooks/useAuth"
import { useSubscription } from "@/lib/hooks/useSubscription"
import { useMatchScores } from "@/lib/hooks/useMatchScores"
import { useJobs } from "@/lib/hooks/useJobs"
import type { JobFilters } from "@/types"

interface JobFeedProps {
  filters: JobFilters
  searchQuery: string
  onMetaChange?: (meta: { totalCount: number; lastHourCount: number }) => void
  hasPrimaryResume?: boolean
}

function JobRowSkeleton() {
  return (
    <div className="bg-surface px-4 py-4 sm:px-5">
      <div className="flex gap-4">
        <div className="h-11 w-11 flex-shrink-0 animate-pulse rounded-md bg-surface-muted sm:h-12 sm:w-12" />
        <div className="min-w-0 flex-1 space-y-3">
          <div className="h-2.5 w-20 animate-pulse rounded bg-surface-muted" />
          <div className="h-4 w-3/4 max-w-md animate-pulse rounded bg-surface-muted" />
          <div className="h-3 w-1/2 animate-pulse rounded bg-surface-muted" />
          <div className="flex gap-2">
            <div className="h-6 w-16 animate-pulse rounded border border-border bg-surface-muted" />
            <div className="h-6 w-20 animate-pulse rounded border border-border bg-surface-muted" />
          </div>
        </div>
      </div>
      <div className="mt-4 flex justify-end border-t border-border pt-3">
        <div className="h-9 w-28 animate-pulse rounded-md bg-surface-muted" />
      </div>
    </div>
  )
}

export default function JobFeed({
  filters,
  searchQuery,
  onMetaChange,
  hasPrimaryResume = false,
}: JobFeedProps) {
  const personalized = hasPrimaryResume && (filters.sort ?? "freshest") === "match"
  const {
    jobs,
    isLoading,
    hasMore,
    loadMore,
    totalCount,
    lastHourCount,
    newJobsCount,
    refresh,
  } = useJobs(filters, searchQuery, { personalized })
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const shouldLoadBatchScores = hasPrimaryResume && !personalized
  const { getScore, isLoading: scoresLoading } = useMatchScores(
    shouldLoadBatchScores ? jobs.map((job) => job.id) : []
  )

  const { profile } = useAuth()
  const { isProInternational } = useSubscription()
  const h1bEnabled = Boolean(
    profile?.needs_sponsorship || profile?.is_international || isProInternational
  )

  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(id)
  }, [])

  const lastMetaRef = useRef({ totalCount: -1, lastHourCount: -1 })
  useEffect(() => {
    if (
      lastMetaRef.current.totalCount === totalCount &&
      lastMetaRef.current.lastHourCount === lastHourCount
    ) {
      return
    }
    lastMetaRef.current = { totalCount, lastHourCount }
    onMetaChange?.({ totalCount, lastHourCount })
  }, [lastHourCount, onMetaChange, totalCount])

  useEffect(() => {
    if (!sentinelRef.current || !hasMore) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadMore()
      },
      { rootMargin: "700px 0px" }
    )

    observer.observe(sentinelRef.current)
    return () => observer.disconnect()
  }, [hasMore, loadMore])

  return (
    <H1BPredictionProvider enabled={h1bEnabled}>
    <div className="space-y-4">
      {personalized && (
        <div className="flex items-center gap-2 border border-border bg-surface-alt px-4 py-2.5 text-sm font-medium text-brand-navy">
          <Sparkles className="h-4 w-4 shrink-0 text-primary" />
          Personalized for you
        </div>
      )}

      {newJobsCount > 0 && (
        <button
          type="button"
          onClick={() => void refresh()}
          className="flex w-full items-center justify-center gap-2 border border-border bg-surface-alt px-4 py-2.5 text-sm font-medium text-brand-navy transition-colors hover:bg-brand-tint"
        >
          <Sparkles className="h-4 w-4" />
          {newJobsCount.toLocaleString()} new job
          {newJobsCount === 1 ? "" : "s"} just posted
          <span className="text-primary">click to load</span>
        </button>
      )}

      {isLoading && jobs.length === 0 && (
        <div className="job-feed-panel divide-y divide-border">
          <JobRowSkeleton />
          <JobRowSkeleton />
          <JobRowSkeleton />
        </div>
      )}

      {!isLoading && jobs.length === 0 && (
        <div className="empty-state rounded-lg">
          <p className="text-base font-semibold text-strong">No jobs match your filters</p>
          <p className="mt-2 text-sm text-muted-foreground">Try widening your search</p>
        </div>
      )}

      {jobs.length > 0 && (
        <div className="job-feed-panel">
          {jobs.map((job, i) => (
            <JobCard
              key={job.id}
              job={job}
              hasPrimaryResume={hasPrimaryResume}
              analysisIndex={i}
              now={now}
              matchScore={job.match_score ?? getScore(job.id)}
              isMatchScoreLoading={
                shouldLoadBatchScores &&
                !job.match_score &&
                scoresLoading &&
                !getScore(job.id)
              }
            />
          ))}
        </div>
      )}

      <div ref={sentinelRef} />

      {hasMore && jobs.length > 0 && (
        <div className="flex justify-center py-2">
          {isLoading ? (
            <div className="text-sm text-muted-foreground">Loading more jobs…</div>
          ) : (
            <button
              type="button"
              onClick={() => void loadMore()}
              className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-surface-alt hover:text-strong"
            >
              Load more
              <ArrowUp className="h-4 w-4 rotate-180" />
            </button>
          )}
        </div>
      )}
    </div>
    </H1BPredictionProvider>
  )
}
