"use client"

import { useEffect, useState } from "react"
import { ArrowLeft, Loader2 } from "lucide-react"
import Link from "next/link"
import { cn } from "@/lib/utils"
import type { PipelineStats } from "@/types"

const STATUS_BARS = [
  { key: "saved", label: "Saved", color: "bg-slate-400" },
  { key: "applied", label: "Applied", color: "bg-blue-400" },
  { key: "phone_screen", label: "Phone Screen", color: "bg-amber-400" },
  { key: "interview", label: "Interview", color: "bg-violet-400" },
  { key: "final_round", label: "Final Round", color: "bg-indigo-500" },
  { key: "offer", label: "Offer", color: "bg-emerald-500" },
  { key: "rejected", label: "Rejected", color: "bg-red-400" },
  { key: "withdrawn", label: "Withdrawn", color: "bg-slate-300" },
]

function BarChart({ data }: { data: { label: string; value: number; color: string }[] }) {
  const max = Math.max(...data.map((d) => d.value), 1)
  return (
    <div className="space-y-2.5">
      {data.map((d) => (
        <div key={d.label} className="flex items-center gap-3">
          <span className="w-24 shrink-0 text-right text-[12px] font-medium text-slate-500">{d.label}</span>
          <div className="h-6 flex-1 overflow-hidden rounded-full bg-slate-100">
            <div
              className={cn("h-full rounded-full transition-all duration-700", d.color)}
              style={{ width: `${Math.round((d.value / max) * 100)}%` }}
            />
          </div>
          <span className="w-8 text-right text-[12.5px] font-semibold text-slate-700">{d.value}</span>
        </div>
      ))}
    </div>
  )
}

function MetricCard({ label, value, sub, accent }: { label: string; value: string | number; sub: string; accent?: string }) {
  return (
    <div className="rounded-[16px] border border-slate-200/80 bg-white p-5 shadow-[0_1px_0_rgba(15,23,42,0.04),0_8px_24px_rgba(15,23,42,0.05)]">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.2em] text-slate-400">{label}</p>
      <p className={cn("mt-2 text-3xl font-bold tracking-tight", accent ?? "text-slate-900")}>{value}</p>
      <p className="mt-1 text-[11.5px] text-slate-500">{sub}</p>
    </div>
  )
}

export default function ApplicationInsightsPage() {
  const [stats, setStats] = useState<PipelineStats | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    fetch("/api/applications/stats")
      .then((r) => r.json())
      .then((data) => setStats(data))
      .finally(() => setIsLoading(false))
  }, [])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-[#FF5C18]" />
      </div>
    )
  }

  if (!stats) return null

  const byStatusData = STATUS_BARS.map((s) => ({
    label: s.label,
    value: (stats.by_status as any)[s.key] ?? 0,
    color: s.color,
  })).filter((d) => d.value > 0)

  const conversionData = [
    { label: "App → Screen", value: stats.conversion_rates.applied_to_phone, color: "bg-amber-400" },
    { label: "Screen → Interview", value: stats.conversion_rates.phone_to_interview, color: "bg-violet-400" },
    { label: "Interview → Offer", value: stats.conversion_rates.interview_to_offer, color: "bg-emerald-500" },
    { label: "Overall", value: stats.conversion_rates.overall, color: "bg-[#FF5C18]" },
  ]

  const activeCount =
    (stats.by_status.phone_screen ?? 0) +
    (stats.by_status.interview ?? 0) +
    (stats.by_status.final_round ?? 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/dashboard/applications"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition hover:text-slate-800"
        >
          <ArrowLeft className="h-4 w-4" />
          Pipeline
        </Link>
        <span className="text-slate-300">/</span>
        <p className="text-sm font-medium text-slate-700">Insights</p>
      </div>

      <div>
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-slate-400">Analytics</p>
        <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-slate-900">Pipeline Insights</h1>
      </div>

      {/* Key metrics */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Total tracked" value={stats.total} sub={`${stats.applications_this_month} this month`} />
        <MetricCard label="Response rate" value={`${stats.response_rate}%`} sub={`avg ${stats.avg_days_to_response} days to respond`} accent="text-[#FF5C18]" />
        <MetricCard label="Active rounds" value={activeCount} sub="screen · interview · final" accent="text-violet-600" />
        <MetricCard label="Offers" value={stats.by_status.offer ?? 0} sub={`${stats.conversion_rates.overall}% overall win rate`} accent="text-emerald-600" />
      </div>

      {/* Status breakdown */}
      <div className="rounded-[18px] border border-slate-200/80 bg-white p-6 shadow-[0_1px_0_rgba(15,23,42,0.04),0_8px_24px_rgba(15,23,42,0.05)]">
        <p className="mb-5 text-[10.5px] font-semibold uppercase tracking-[0.2em] text-slate-400">Applications by status</p>
        <BarChart data={byStatusData} />
      </div>

      {/* Conversion funnel */}
      <div className="rounded-[18px] border border-slate-200/80 bg-white p-6 shadow-[0_1px_0_rgba(15,23,42,0.04),0_8px_24px_rgba(15,23,42,0.05)]">
        <p className="mb-5 text-[10.5px] font-semibold uppercase tracking-[0.2em] text-slate-400">Conversion rates</p>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {conversionData.map((c) => (
            <div key={c.label} className="space-y-2">
              <div className="flex items-end justify-between">
                <p className="text-[12px] font-medium text-slate-600">{c.label}</p>
                <p className="text-xl font-bold text-slate-900">{c.value}%</p>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                <div
                  className={cn("h-full rounded-full transition-all duration-700", c.color)}
                  style={{ width: `${c.value}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Volume */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-[18px] border border-slate-200/80 bg-white p-6 shadow-[0_1px_0_rgba(15,23,42,0.04),0_8px_24px_rgba(15,23,42,0.05)]">
          <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.2em] text-slate-400">This week</p>
          <p className="text-4xl font-bold tracking-tight text-slate-900">{stats.applications_this_week}</p>
          <p className="mt-1 text-sm text-slate-500">applications submitted</p>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-[#FF5C18] transition-all duration-700"
              style={{ width: `${Math.min(100, (stats.applications_this_week / Math.max(stats.applications_this_month, 1)) * 100 * 4)}%` }}
            />
          </div>
        </div>

        <div className="rounded-[18px] border border-slate-200/80 bg-white p-6 shadow-[0_1px_0_rgba(15,23,42,0.04),0_8px_24px_rgba(15,23,42,0.05)]">
          <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.2em] text-slate-400">This month</p>
          <p className="text-4xl font-bold tracking-tight text-slate-900">{stats.applications_this_month}</p>
          <p className="mt-1 text-sm text-slate-500">applications submitted</p>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-[#062246] transition-all duration-700"
              style={{ width: `${Math.min(100, (stats.applications_this_month / Math.max(stats.total, 1)) * 100)}%` }}
            />
          </div>
        </div>
      </div>

      {/* Tip */}
      {stats.response_rate < 15 && stats.total > 5 && (
        <div className="rounded-[16px] border border-[#FFD2B8] bg-[#FFF7F2] p-4">
          <p className="font-semibold text-[#9A3412]">Response rate below 15%</p>
          <p className="mt-1 text-sm text-[#9A3412]/80">
            Try tailoring your resume to each job description, or add a cover letter.
            <Link href="/dashboard/resume" className="ml-1 underline underline-offset-2">Optimize resume →</Link>
          </p>
        </div>
      )}
    </div>
  )
}
