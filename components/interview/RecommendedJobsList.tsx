"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Zap } from "lucide-react"
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
  const colors = [
    "bg-blue-100 text-blue-700",
    "bg-violet-100 text-violet-700",
    "bg-emerald-100 text-emerald-700",
    "bg-amber-100 text-amber-700",
    "bg-pink-100 text-pink-700",
    "bg-cyan-100 text-cyan-700",
    "bg-orange-100 text-orange-700",
  ]
  const color = colors[letter.charCodeAt(0) % colors.length]
  return (
    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[13px] font-bold shadow-sm ${color}`}>
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
      <section className={cn("rounded-lg border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]", className)}>
        <div className="h-4 w-44 animate-pulse rounded-full bg-slate-100" />
        <div className="mt-3 space-y-2">
          {[0, 1].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg bg-slate-100" />
          ))}
        </div>
      </section>
    )
  }

  if (jobs.length === 0) return null

  return (
    <section className={cn("rounded-lg border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]", className)}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-orange-600">
            Pipeline practice
          </p>
          <h2 className="mt-1 text-sm font-semibold text-slate-950">Saved jobs to rehearse</h2>
        </div>
      </div>

      <div className="space-y-2">
        {jobs.map((job) => (
          <div
            key={job.id}
            className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-3 transition hover:border-slate-300 hover:bg-slate-50"
          >
            <CompanyInitial name={job.company} />

            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold text-slate-900">
                {job.title}
              </p>
              <p className="text-[11px] text-slate-400">
                {job.company} · saved {formatDate(job.savedAt)}
              </p>
            </div>

            <Link
              href={`/dashboard/interview/setup?jobId=${job.id}`}
              className="flex shrink-0 items-center gap-1.5 rounded-lg border border-orange-200 bg-orange-50 px-3 py-1.5 text-[12px] font-semibold text-orange-700 transition hover:bg-orange-100"
            >
              <Zap className="h-3 w-3" />
              Practice
            </Link>
          </div>
        ))}
      </div>
    </section>
  )
}
