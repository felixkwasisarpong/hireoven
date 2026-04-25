"use client"

import { useEffect, useRef, useState } from "react"
import { ArrowUp, Sparkles } from "lucide-react"
import JobCardV2 from "@/components/jobs/JobCardV2"
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
    <div className="overflow-hidden rounded-xl border border-[#E5E7EB] bg-white">
      {/* Header section */}
      <div className="flex items-start gap-4 p-5">
        <div className="h-12 w-12 flex-shrink-0 animate-pulse rounded-lg bg-slate-100" />
        <div className="min-w-0 flex-1 space-y-2.5">
          <div className="h-4 w-2/3 max-w-xs animate-pulse rounded-full bg-slate-100" />
          <div className="flex items-center gap-2">
            <div className="h-3 w-24 animate-pulse rounded-full bg-slate-100" />
            <div className="h-3 w-16 animate-pulse rounded-full bg-slate-100" />
          </div>
          <div className="flex gap-3 pt-0.5">
            <div className="h-3 w-20 animate-pulse rounded-full bg-slate-100" />
            <div className="h-3 w-16 animate-pulse rounded-full bg-slate-100" />
            <div className="h-3 w-14 animate-pulse rounded-full bg-slate-100" />
          </div>
          <div className="flex gap-1.5 pt-1">
            <div className="h-5 w-14 animate-pulse rounded-full bg-slate-100" />
            <div className="h-5 w-16 animate-pulse rounded-full bg-slate-100" />
            <div className="h-5 w-12 animate-pulse rounded-full bg-slate-100" />
          </div>
        </div>
      </div>
      {/* Intelligence strip */}
      <div className="flex items-center justify-between border-t border-[#F1F5F9] bg-[#FAFAFA] px-5 py-2.5">
        <div className="flex gap-2">
          <div className="h-5 w-20 animate-pulse rounded-full bg-slate-200/70" />
          <div className="h-5 w-24 animate-pulse rounded-full bg-slate-200/70" />
        </div>
        <div className="flex items-center gap-3">
          <div className="h-4 w-8 animate-pulse rounded-full bg-slate-200/70" />
          <div className="h-7 w-16 animate-pulse rounded-md bg-slate-200/70" />
        </div>
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
  } = useJobs(filters, searchQuery, { personalized, withScores: hasPrimaryResume && !personalized })
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  /** Embedded `match_score` from /api/jobs covers most jobs; only fetch any that arrive without one. */
  const missingScoreIds = hasPrimaryResume && !personalized
    ? jobs.filter((job) => !job.match_score).map((job) => job.id)
    : []
  const { getScore, isLoading: scoresLoading } = useMatchScores(missingScoreIds)

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

  /** “Best match” must follow the same % as the card, not feed position #1 (rank blends freshness). */
  let bestMatchJobId: string | null = null
  if (filters.sort === "match") {
    let top = -1
    for (const job of jobs) {
      const ms = job.match_score ?? getScore(job.id)
      const overall = ms?.overall_score
      if (overall == null) continue
      if (overall > top) {
        top = overall
        bestMatchJobId = job.id
      }
    }
  }

  return (
    <H1BPredictionProvider enabled={h1bEnabled}>
    <div className="space-y-4">
      {newJobsCount > 0 && (
        <button
          type="button"
          onClick={() => void refresh()}
          className="neo-strip flex w-full items-center justify-center gap-2 text-[13px] font-semibold text-brand-navy transition-colors hover:brightness-[1.02]"
        >
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          {newJobsCount.toLocaleString()} new job{newJobsCount === 1 ? "" : "s"} — click to load
        </button>
      )}

      {isLoading && jobs.length === 0 && (
        <div className="space-y-3">
          <JobRowSkeleton />
          <JobRowSkeleton />
          <JobRowSkeleton />
        </div>
      )}

      {!isLoading && jobs.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-6 py-14 text-center">
          <p className="text-[15px] font-semibold text-slate-700">No jobs match your filters</p>
          <p className="mt-1.5 text-sm text-slate-500">Try widening your search or removing some filters</p>
        </div>
      )}

      {jobs.length > 0 && (
        <div className="space-y-3 animate-fade-in">
          {jobs.map((job, i) => (
            <JobCardV2
              key={job.id}
              job={job}
              hasPrimaryResume={hasPrimaryResume}
              analysisIndex={i}
              isBestMatch={Boolean(bestMatchJobId && job.id === bestMatchJobId)}
              now={now}
              priorityLogo={i < 6}
              matchScore={job.match_score ?? getScore(job.id)}
              isMatchScoreLoading={
                hasPrimaryResume &&
                !personalized &&
                !job.match_score &&
                scoresLoading &&
                !getScore(job.id)
              }
              showVisaSignals={h1bEnabled}
            />
          ))}
        </div>
      )}

      <div ref={sentinelRef} />

      {hasMore && jobs.length > 0 && (
        <div className="flex justify-center py-2">
          {isLoading ? (
            <div className="text-[13px] text-slate-400">Loading…</div>
          ) : (
            <button
              type="button"
              onClick={() => void loadMore()}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-[13px] font-medium text-slate-500 shadow-sm transition-colors hover:bg-slate-50 hover:text-slate-700"
            >
              Load more
              <ArrowUp className="h-3.5 w-3.5 rotate-180" />
            </button>
          )}
        </div>
      )}
    </div>
    </H1BPredictionProvider>
  )
}
