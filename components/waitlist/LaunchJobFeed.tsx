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
  freshColor: "green" | "teal"
}

const JOBS: FeedJob[] = [
  {
    id: "1",
    initial: "S",
    logoBg: "bg-[#0D9488]",
    title: "Software Engineer, Backend",
    location: "San Francisco - Hybrid",
    freshness: "Just now",
    freshColor: "green",
  },
  {
    id: "2",
    initial: "N",
    logoBg: "bg-[#0f172a]",
    title: "Product Designer",
    location: "Remote",
    freshness: "1 min ago",
    freshColor: "green",
  },
  {
    id: "3",
    initial: "L",
    logoBg: "bg-[#7C3AED]",
    title: "Senior Frontend Engineer",
    location: "Remote",
    freshness: "3 min ago",
    freshColor: "teal",
  },
  {
    id: "4",
    initial: "V",
    logoBg: "bg-[#0f172a]",
    title: "DevOps Engineer",
    location: "Remote",
    freshness: "7 min ago",
    freshColor: "teal",
  },
  {
    id: "5",
    initial: "F",
    logoBg: "bg-[#F24E1E]",
    title: "Growth Marketing Manager",
    location: "New York - Hybrid",
    freshness: "Just now",
    freshColor: "green",
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
    <div
      className="relative h-[420px] overflow-hidden rounded-3xl border border-border bg-card p-4 shadow-[0_24px_80px_rgba(15,23,42,0.08)]"
      aria-hidden
    >
      <div className="mb-3 flex items-center justify-between border-b border-border pb-3">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Live detections
        </p>
        <span className="flex items-center gap-1.5 text-xs font-medium text-teal-600">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-teal-500 opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-teal-500" />
          </span>
          Watching
        </span>
      </div>
      <div className="flex flex-col gap-3">
        {visible.map((job, idx) => (
          <article
            key={`${job.id}-${visibleCount}-${idx}`}
            className="animate-launch-feed-card rounded-2xl border border-border bg-surface p-4 shadow-sm"
          >
            <div className="flex gap-3">
              <div
                className={cn(
                  "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-lg font-bold text-white shadow-inner",
                  job.logoBg
                )}
              >
                {job.initial}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-strong">{job.title}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">{job.location}</p>
                <p className="mt-2 flex items-center gap-1.5 text-sm font-bold">
                  <span
                    className={cn(
                      "h-2 w-2 rounded-full",
                      job.freshColor === "green" ? "bg-emerald-500" : "bg-teal-500"
                    )}
                  />
                  <span
                    className={
                      job.freshColor === "green"
                        ? "text-emerald-600"
                        : "text-teal-600"
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
