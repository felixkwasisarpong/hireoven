"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { ArrowRight, Zap } from "lucide-react"
import { cn } from "@/lib/utils"

type RecommendedJob = {
  id: string
  title: string
  company: string
  savedAt: string
}

type RecommendedJobsListProps = {
  initialJobs?: RecommendedJob[]
  initialLoaded?: boolean
  className?: string
}

function formatDate(iso: string) {
  const d = new Date(iso)
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000)
  if (days === 0) return "Today"
  if (days === 1) return "Yesterday"
  if (days < 7) return `${days}d ago`
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

function CompanyInitial({ name }: { name: string }) {
  const letter = name.trim()[0]?.toUpperCase() ?? "?"
  const colors: Array<{ bg: string; text: string }> = [
    { bg: "#fff3ea", text: "#ec6516" },
    { bg: "#eef4ff", text: "#2563eb" },
    { bg: "#ecfdf5", text: "#0f9d6a" },
    { bg: "#fff7ed", text: "#c2530d" },
    { bg: "#f3eeff", text: "#7c3aed" },
  ]
  const color = colors[letter.charCodeAt(0) % colors.length]
  return (
    <div
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px] text-[14px] font-extrabold"
      style={{ backgroundColor: color.bg, color: color.text }}
    >
      {letter}
    </div>
  )
}

export default function RecommendedJobsList({
  initialJobs = [],
  initialLoaded = false,
  className,
}: RecommendedJobsListProps) {
  const [jobs, setJobs] = useState<RecommendedJob[]>(initialJobs)
  const [loading, setLoading] = useState(!initialLoaded)

  useEffect(() => {
    if (initialLoaded) return

    fetch("/api/interview/recommendations")
      .then((r) => r.json())
      .then((d) => setJobs(d.jobs ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [initialLoaded])

  if (loading) {
    return (
      <section className={cn(className)}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="h-5 w-56 animate-pulse rounded-full bg-slate-100" />
          <div className="h-4 w-14 animate-pulse rounded-full bg-slate-100" />
        </div>
        <div className="mt-3 space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[66px] animate-pulse rounded-[14px] bg-slate-100" />
          ))}
        </div>
      </section>
    )
  }

  return (
    <section className={cn(className)}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-[16px] font-bold text-[#0d1424]">Rehearse against a saved job</h2>
        <Link
          href="/dashboard/applications"
          className="inline-flex items-center gap-1 text-[13px] font-semibold text-[#2563eb] transition hover:text-blue-700"
        >
          View all <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </div>

      <div className="space-y-2">
        {jobs.length === 0 ? (
          <div className="rounded-[14px] border border-[#eef0f4] bg-white px-4 py-5 text-[13px] text-[#98a1b0]">
            Save a job first, then come back to rehearse against the real role.
          </div>
        ) : jobs.map((job) => (
          <div
            key={job.id}
            className="flex items-center gap-[13px] rounded-[14px] border border-[#eef0f4] bg-white px-3.5 py-[13px] transition hover:border-[#dfe3ea]"
          >
            <CompanyInitial name={job.company} />

            <div className="min-w-0 flex-1">
              <p className="truncate text-[14.5px] font-bold text-[#0f1729]">
                {job.title}
              </p>
              <p className="mt-0.5 truncate text-[12.5px] text-[#98a1b0]">
                {job.company} · saved {formatDate(job.savedAt)}
              </p>
            </div>

            <Link
              href={`/dashboard/interview/setup?jobId=${job.id}`}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] border border-[#ffdcc4] bg-[#fff6f0] px-3.5 text-[13px] font-semibold text-[#c2530d] transition hover:bg-[#ffeede] active:translate-y-px"
            >
              <Zap className="h-3.5 w-3.5 fill-[#ec6516] text-[#ec6516]" />
              Practice
            </Link>
          </div>
        ))}
      </div>
    </section>
  )
}
