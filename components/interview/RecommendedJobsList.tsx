"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Zap } from "lucide-react"

type RecommendedJob = {
  id: string
  title: string
  company: string
  savedAt: string
}

type RecommendedJobsListProps = {
  initialJobs?: RecommendedJob[]
  initialLoaded?: boolean
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
      <section className="mt-10">
        <div className="h-3.5 w-48 animate-pulse rounded-full bg-slate-100" />
        <div className="mt-3 space-y-2">
          {[0, 1].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-slate-100" />
          ))}
        </div>
      </section>
    )
  }

  if (jobs.length === 0) return null

  return (
    <section className="mt-10">
      <div className="mb-3 flex items-center gap-2">
        <div className="h-4 w-0.5 rounded-full bg-indigo-400" />
        <h2 className="text-[12px] font-bold uppercase tracking-widest text-slate-400">
          Practice for your pipeline
        </h2>
      </div>

      <div className="space-y-2">
        {jobs.map((job) => (
          <div
            key={job.id}
            className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-[0_1px_6px_rgba(15,23,42,0.05)] transition hover:border-slate-300 hover:shadow-[0_4px_12px_rgba(15,23,42,0.08)]"
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
              className="flex shrink-0 items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-[12px] font-semibold text-indigo-600 transition hover:bg-indigo-100"
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
