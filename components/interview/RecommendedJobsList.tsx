"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Briefcase } from "lucide-react"

type RecommendedJob = {
  id: string
  title: string
  company: string
  savedAt: string
}

function formatDate(iso: string) {
  const d = new Date(iso)
  const now = Date.now()
  const diff = now - d.getTime()
  const days = Math.floor(diff / 86_400_000)
  if (days === 0) return "Today"
  if (days === 1) return "Yesterday"
  if (days < 7) return `${days}d ago`
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

export default function RecommendedJobsList() {
  const [jobs, setJobs] = useState<RecommendedJob[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/interview/recommendations")
      .then((r) => r.json())
      .then((d) => setJobs(d.jobs ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <section className="mt-8">
        <div className="h-4 w-48 animate-pulse rounded bg-slate-100" />
        <div className="mt-3 space-y-2">
          {[0, 1].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-lg bg-slate-100" />
          ))}
        </div>
      </section>
    )
  }

  if (jobs.length === 0) return null

  return (
    <section className="mt-8">
      <h2 className="text-[14px] font-semibold text-slate-700">Practice for jobs in your pipeline</h2>
      <div className="mt-3 space-y-2">
        {jobs.map((job) => (
          <div
            key={job.id}
            className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
              <Briefcase className="h-4 w-4" strokeWidth={2} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold text-slate-900">
                {job.title} @ {job.company}
              </p>
              <p className="text-[11px] text-slate-400">{formatDate(job.savedAt)}</p>
            </div>
            <Link
              href={`/dashboard/interview/setup?jobId=${job.id}`}
              className="shrink-0 rounded-lg border border-orange-200 bg-orange-50 px-3 py-1.5 text-[12px] font-semibold text-orange-600 transition hover:bg-orange-100"
            >
              Practice
            </Link>
          </div>
        ))}
      </div>
    </section>
  )
}
