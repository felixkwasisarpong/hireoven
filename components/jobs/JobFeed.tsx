"use client"

import { useEffect, useRef } from "react"
import { ArrowUp, Sparkles } from "lucide-react"
import JobCard from "@/components/jobs/JobCard"
import { useJobs } from "@/lib/hooks/useJobs"
import type { JobFilters } from "@/types"

interface JobFeedProps {
  filters: JobFilters
  searchQuery: string
  onMetaChange?: (meta: { totalCount: number; lastHourCount: number }) => void
  hasPrimaryResume?: boolean
}

function JobCardSkeleton() {
  return (
    <div className="rounded-[18px] border border-slate-200/80 bg-white p-5">
      <div className="flex gap-4">
        <div className="h-10 w-10 animate-pulse rounded-2xl bg-slate-100" />
        <div className="flex-1 space-y-3">
          <div className="h-3 w-24 animate-pulse rounded-full bg-slate-100" />
          <div className="h-5 w-2/3 animate-pulse rounded-full bg-slate-100" />
          <div className="h-4 w-1/2 animate-pulse rounded-full bg-slate-100" />
          <div className="flex gap-2">
            <div className="h-7 w-20 animate-pulse rounded-full bg-slate-100" />
            <div className="h-7 w-24 animate-pulse rounded-full bg-slate-100" />
          </div>
        </div>
      </div>
      <div className="mt-5 h-10 animate-pulse rounded-2xl bg-slate-100" />
    </div>
  )
}

export default function JobFeed({
  filters,
  searchQuery,
  onMetaChange,
  hasPrimaryResume = false,
}: JobFeedProps) {
  const {
    jobs,
    isLoading,
    hasMore,
    loadMore,
    totalCount,
    lastHourCount,
    newJobsCount,
    refresh,
  } = useJobs(filters, searchQuery)
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
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
    <div className="space-y-4">
      {newJobsCount > 0 && (
        <button
          type="button"
          onClick={() => void refresh()}
          className="flex w-full items-center justify-center gap-2 rounded-[16px] border border-[#FFD2B8] bg-[#FFF8F4] px-4 py-3 text-sm font-medium text-[#062246] transition hover:bg-[#FFF1E8]"
        >
          <Sparkles className="h-4 w-4" />
          {newJobsCount.toLocaleString()} new job
          {newJobsCount === 1 ? "" : "s"} just posted
          <span className="text-[#FF5C18]">click to load</span>
        </button>
      )}

      {isLoading && jobs.length === 0 && (
        <div className="space-y-4">
          <JobCardSkeleton />
          <JobCardSkeleton />
          <JobCardSkeleton />
        </div>
      )}

      {!isLoading && jobs.length === 0 && (
        <div className="rounded-[18px] border border-dashed border-gray-300 bg-white px-8 py-14 text-center">
        
          <p className="text-lg font-semibold text-gray-900">
            No jobs match your filters
          </p>
          <p className="mt-2 text-sm text-gray-500">
            Try widening your search
          </p>
        </div>
      )}

      {jobs.length > 0 && (
        <div className="space-y-4">
          {jobs.map((job, i) => (
            <JobCard key={job.id} job={job} hasPrimaryResume={hasPrimaryResume} analysisIndex={i} />
          ))}
        </div>
      )}

      <div ref={sentinelRef} />

      {hasMore && jobs.length > 0 && (
        <div className="flex justify-center py-4">
          {isLoading ? (
            <div className="text-sm text-gray-500">Loading more jobs…</div>
          ) : (
            <button
              type="button"
              onClick={() => void loadMore()}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200/80 bg-white/95 px-4 py-2.5 text-sm font-medium text-slate-700 shadow-[0_8px_22px_rgba(15,23,42,0.04)] transition hover:border-slate-300 hover:bg-slate-50"
            >
              Load more
              <ArrowUp className="h-4 w-4 rotate-180" />
            </button>
          )}
        </div>
      )}
    </div>
  )
}
