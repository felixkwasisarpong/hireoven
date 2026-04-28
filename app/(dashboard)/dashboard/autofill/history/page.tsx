"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import {
  ArrowLeft,
  Zap,
  Clock,
  TrendingUp,
  BarChart2,
  ChevronRight,
  Loader2,
  CalendarDays,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

// ── Types ──────────────────────────────────────────────────────────────────

type HistoryEntry = {
  id: string
  job_id: string | null
  company_name: string | null
  job_title: string | null
  ats_type: string | null
  fields_filled: number
  fields_total: number
  fill_rate: number | null
  applied_at: string
}

// ── Stat card ──────────────────────────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  color = "sky",
}: {
  icon: React.ElementType
  label: string
  value: string | number
  sub?: string
  color?: "sky" | "green" | "violet" | "amber"
}) {
  const colors = {
    sky: "bg-[#FFF1E8] text-[#FF5C18]",
    green: "bg-green-50 text-green-600",
    violet: "bg-orange-50 text-orange-600",
    amber: "bg-amber-50 text-amber-600",
  }
  return (
    <div className="metric-tile flex items-start gap-4">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${colors[color]}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">{label}</p>
        <p className="text-2xl font-bold text-gray-900 mt-0.5">{value}</p>
        {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

// ── Fill rate badge ────────────────────────────────────────────────────────

function FillRateBadge({ rate }: { rate: number | null }) {
  const r = rate ?? 0
  const color =
    r >= 80
      ? "bg-green-100 text-green-700"
      : r >= 50
      ? "bg-amber-100 text-amber-700"
      : "bg-red-100 text-red-700"
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${color}`}>
      {r}%
    </span>
  )
}

// ── ATS badge ─────────────────────────────────────────────────────────────

function AtsBadge({ ats }: { ats: string | null }) {
  if (!ats || ats === "generic") return null
  const colors: Record<string, string> = {
    greenhouse: "bg-emerald-100 text-emerald-700",
    lever: "bg-blue-100 text-blue-700",
    ashby: "bg-orange-100 text-orange-700",
    workday: "bg-orange-100 text-orange-700",
  }
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${
        colors[ats] ?? "bg-gray-100 text-gray-600"
      }`}
    >
      {ats}
    </span>
  )
}

// ── History row ────────────────────────────────────────────────────────────

function HistoryRow({ entry }: { entry: HistoryEntry }) {
  const date = new Date(entry.applied_at)
  const dateStr = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
  const timeStr = date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  })

  return (
    <div className="flex items-center gap-4 px-4 py-3.5 hover:bg-gray-50 transition-colors group">
      {/* Color strip */}
      <div className="w-1 h-10 rounded-full bg-[#FF5C18] flex-shrink-0" />

      {/* Main info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-semibold text-gray-800 truncate">
            {entry.job_title || "Untitled position"}
          </p>
          <AtsBadge ats={entry.ats_type} />
        </div>
        <p className="text-xs text-gray-500 mt-0.5 truncate">
          {entry.company_name || "Unknown company"}
        </p>
      </div>

      {/* Fill rate */}
      <FillRateBadge rate={entry.fill_rate} />

      {/* Fields */}
      <div className="text-right hidden sm:block">
        <p className="text-sm font-medium text-gray-700">
          {entry.fields_filled}/{entry.fields_total}
        </p>
        <p className="text-xs text-gray-400">fields</p>
      </div>

      {/* Date */}
      <div className="text-right hidden md:block">
        <p className="text-xs font-medium text-gray-600">{dateStr}</p>
        <p className="text-xs text-gray-400">{timeStr}</p>
      </div>

      {/* Job link */}
      {entry.job_id && (
        <Link
          href={`/dashboard/jobs/${entry.job_id}`}
          className="opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => e.stopPropagation()}
        >
          <ChevronRight className="w-4 h-4 text-gray-400 hover:text-gray-600" />
        </Link>
      )}
    </div>
  )
}

// ── Empty state ────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#FFF1E8]">
        <Zap className="w-7 h-7 text-[#FF5C18]" />
      </div>
      <h3 className="text-base font-semibold text-gray-800">No autofill history yet</h3>
      <p className="text-sm text-gray-500 mt-1 max-w-xs">
        When you use autofill on a job application, it will appear here with fill rate stats.
      </p>
      <Button className="mt-4" asChild>
        <Link href="/dashboard">Find jobs to autofill</Link>
      </Button>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function AutofillHistoryPage() {
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [stats, setStats] = useState({
    totalApplications: 0,
    avgFillRate: 0,
    minutesSaved: 0,
  })
  const [loading, setLoading] = useState(true)

  // Filter/group state
  const [filter, setFilter] = useState<"all" | "week" | "month">("all")

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const res = await fetch("/api/autofill/history")
        if (!res.ok) return
        const data = await res.json()
        setHistory(data.history ?? [])
        setStats({
          totalApplications: data.totalApplications ?? 0,
          avgFillRate: data.avgFillRate ?? 0,
          minutesSaved: data.minutesSaved ?? 0,
        })
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [])

  const filteredHistory = history.filter((h) => {
    if (filter === "all") return true
    const d = new Date(h.applied_at)
    const now = new Date()
    if (filter === "week") {
      const weekAgo = new Date(now)
      weekAgo.setDate(weekAgo.getDate() - 7)
      return d >= weekAgo
    }
    if (filter === "month") {
      const monthAgo = new Date(now)
      monthAgo.setMonth(monthAgo.getMonth() - 1)
      return d >= monthAgo
    }
    return true
  })

  const hoursSaved = stats.minutesSaved >= 60
    ? `${(stats.minutesSaved / 60).toFixed(1)}h`
    : `${stats.minutesSaved}m`

  return (
    <div className="app-page">
      <div className="app-shell max-w-6xl px-4 py-8">
        {/* Header */}
        <section className="surface-hero mb-8 p-6">
          <Link
            href="/dashboard/autofill"
            className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-4"
          >
            <ArrowLeft className="w-4 h-4" />
            Autofill profile
          </Link>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="section-kicker">Autofill History</p>
              <h1 className="section-title mt-3">Every application you accelerated</h1>
              <p className="section-copy mt-3 max-w-2xl">
                Every application you've autofilled, with fill rate breakdown.
              </p>
            </div>
            <Button variant="outline" asChild>
              <Link href="/dashboard/autofill">Edit profile</Link>
            </Button>
          </div>
        </section>

        {/* Stats */}
        {!loading && stats.totalApplications > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-8">
            <StatCard
              icon={Zap}
              label="Total autofilled"
              value={stats.totalApplications}
              sub="applications"
              color="sky"
            />
            <StatCard
              icon={TrendingUp}
              label="Avg fill rate"
              value={`${stats.avgFillRate}%`}
              sub="fields filled"
              color="green"
            />
            <StatCard
              icon={Clock}
              label="Time saved"
              value={hoursSaved}
              sub="~12 min per application"
              color="violet"
            />
          </div>
        )}

        {/* History list */}
        <div className="surface-card overflow-hidden p-0">
          {/* Toolbar */}
          {!loading && history.length > 0 && (
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <p className="text-sm font-medium text-gray-700">
                {filteredHistory.length} application{filteredHistory.length !== 1 ? "s" : ""}
              </p>
              <div className="flex gap-1">
                {(["all", "week", "month"] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={[
                      "px-3 py-1 rounded-lg text-xs font-medium transition-colors",
                      filter === f
                        ? "bg-[#FFF7F2] text-[#9A3412]"
                        : "text-gray-500 hover:bg-gray-100",
                    ].join(" ")}
                  >
                    {f === "all" ? "All time" : f === "week" ? "This week" : "This month"}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Content */}
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-5 h-5 animate-spin text-[#FF5C18]" />
            </div>
          ) : filteredHistory.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="divide-y divide-gray-100">
              {filteredHistory.map((entry) => (
                <HistoryRow key={entry.id} entry={entry} />
              ))}
            </div>
          )}
        </div>

        {/* Footer note */}
        {!loading && filteredHistory.length > 0 && (
          <p className="text-xs text-gray-400 text-center mt-4">
            Showing last 100 entries. Time saved is estimated at 3 minutes per application.
          </p>
        )}
      </div>
    </div>
  )
}
