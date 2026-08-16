"use client"

import { useEffect, useMemo, useState } from "react"
import { cn } from "@/lib/utils"

type FeedJob = {
  id: string
  initial: string
  logoBg: string
  title: string
  location: string
  freshness: string
  freshColor: "hot" | "calm"
}

const JOBS: FeedJob[] = [
  {
    id: "1",
    initial: "S",
    logoBg: "bg-[var(--term-amber)]",
    title: "Software Engineer, Backend",
    location: "San Francisco - Hybrid",
    freshness: "Just now",
    freshColor: "hot",
  },
  {
    id: "2",
    initial: "N",
    logoBg: "bg-[#0f172a]",
    title: "Product Designer",
    location: "Remote",
    freshness: "1 min ago",
    freshColor: "hot",
  },
  {
    id: "3",
    initial: "L",
    logoBg: "bg-[#475569]",
    title: "Senior Frontend Engineer",
    location: "Remote",
    freshness: "3 min ago",
    freshColor: "calm",
  },
  {
    id: "4",
    initial: "V",
    logoBg: "bg-[#0f172a]",
    title: "DevOps Engineer",
    location: "Remote",
    freshness: "7 min ago",
    freshColor: "calm",
  },
  {
    id: "5",
    initial: "F",
    logoBg: "bg-[#F24E1E]",
    title: "Growth Marketing Manager",
    location: "New York - Hybrid",
    freshness: "Just now",
    freshColor: "hot",
  },
]

const STEP_MS = 2200

export default function LaunchJobFeed() {
  const [visibleCount, setVisibleCount] = useState(1)

  useEffect(() => {
    const t = window.setInterval(() => {
      setVisibleCount((c) => (c >= JOBS.length ? 1 : c + 1))
    }, STEP_MS)
    return () => window.clearInterval(t)
  }, [])

  const visible = useMemo(() => {
    const start = Math.max(0, JOBS.length - visibleCount)
    return JOBS.slice(start)
  }, [visibleCount])

  return (
    <div className="term-panel relative h-[420px] overflow-hidden p-4" aria-hidden>
      <div className="mb-3 flex items-center justify-between border-b border-[rgba(120,200,160,0.12)] pb-3">
        <p className="term-label">live detections</p>
        <span className="flex items-center gap-1.5 text-xs font-medium text-[#38e08a]">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#38e08a] opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-[#38e08a]" />
          </span>
          Watching
        </span>
      </div>
      <div className="flex flex-col gap-3">
        {visible.map((job, idx) => (
          <article
            key={`${job.id}-${visibleCount}-${idx}`}
            className="animate-launch-feed-card border border-[rgba(120,200,160,0.2)] bg-[#0e1411] p-4"
          >
            <div className="flex gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center border border-[rgba(120,200,160,0.2)] bg-[#0a0e0c] text-lg font-bold text-[#38e08a]">
                {job.initial}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-white">{job.title}</p>
                <p className="mt-0.5 text-sm text-[#ccd6cf]/60">{job.location}</p>
                <p className="mt-2 flex items-center gap-1.5 text-sm font-bold">
                  <span
                    className={cn(
                      "h-2 w-2 rounded-full",
                      job.freshColor === "hot" ? "bg-[#38e08a]" : "bg-[#ccd6cf]/40"
                    )}
                  />
                  <span
                    className={
                      job.freshColor === "hot"
                        ? "text-[#38e08a]"
                        : "text-[#ccd6cf]/55"
                    }
                  >
                    {job.freshness}
                  </span>
                </p>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}
