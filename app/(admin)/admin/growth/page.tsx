"use client"

import { useEffect, useState } from "react"
import type { GrowthMetric, GrowthMetrics } from "@/lib/admin/growth-metrics"

function fmt(n: number | null): string {
  if (n === null) return "—"
  return n.toLocaleString("en-US")
}

// ratio of today (or average) to target, clamped 0..1
function ratio(value: number | null, target: number): number {
  if (value === null || target <= 0) return 0
  return Math.max(0, Math.min(1, value / target))
}

function toneFor(r: number): { bar: string; text: string } {
  if (r >= 1) return { bar: "bg-emerald-500", text: "text-emerald-600" }
  if (r >= 0.5) return { bar: "bg-amber-500", text: "text-amber-600" }
  return { bar: "bg-rose-500", text: "text-rose-600" }
}

function Sparkline({ values, tone }: { values: number[]; tone: string }) {
  if (values.length < 2) return <div className="h-10" />
  const w = 120
  const h = 40
  const max = Math.max(...values, 1)
  const min = Math.min(...values, 0)
  const span = max - min || 1
  const step = w / (values.length - 1)
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(h - ((v - min) / span) * h).toFixed(1)}`)
  const stroke = tone === "bg-emerald-500" ? "#10b981" : tone === "bg-amber-500" ? "#f59e0b" : "#f43f5e"
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible" aria-hidden>
      <polyline points={pts.join(" ")} fill="none" stroke={stroke} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={(w).toFixed(1)} cy={(h - ((values[values.length - 1] - min) / span) * h).toFixed(1)} r={2.5} fill={stroke} />
    </svg>
  )
}

function MetricCard({ m }: { m: GrowthMetric }) {
  const unit = m.unit === "percent" ? "%" : ""
  const r = ratio(m.today, m.target)
  const tone = toneFor(r)

  if (!m.tracked) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-[13px] font-medium text-slate-500">{m.label}</p>
        <p className="mt-2 text-[26px] font-bold text-slate-300">—</p>
        <p className="mt-1 text-[12px] text-slate-400">
          Target {fmt(m.target)}/day · tracked in {m.source}
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[13px] font-medium text-slate-500">{m.label}</p>
          <p className="mt-1 text-[26px] font-bold tabular-nums text-slate-900">
            {fmt(m.today)}
            {unit}
          </p>
        </div>
        <Sparkline values={m.series.map((p) => p.value)} tone={tone.bar} />
      </div>

      <div className="mt-3">
        <div className="flex items-center justify-between text-[11.5px] text-slate-500">
          <span>
            Target {fmt(m.target)}
            {unit}
            {m.unit === "count" ? "/day" : ""}
          </span>
          <span className={`font-semibold ${tone.text}`}>{Math.round(r * 100)}%</span>
        </div>
        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${Math.round(r * 100)}%` }} />
        </div>
        <p className="mt-2 text-[11.5px] text-slate-400">
          {m.unit === "percent" ? `Avg ${fmt(m.average)}% over ${m.series.length}d` : `Avg ${fmt(m.average)}/day over ${m.series.length}d`}
        </p>
      </div>
    </div>
  )
}

export default function AdminGrowthPage() {
  const [data, setData] = useState<GrowthMetrics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    fetch("/api/admin/growth")
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Failed (${res.status})`)
        return res.json()
      })
      .then((d: GrowthMetrics) => {
        if (alive) setData(d)
      })
      .catch((e: Error) => alive && setError(e.message))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [])

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Growth</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          North Star metrics vs the plan&apos;s daily targets. UTC days
          {data ? ` · last ${data.windowDays} days` : ""}.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : error ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>
      ) : data ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.metrics.map((m) => (
            <MetricCard key={m.key} m={m} />
          ))}
        </div>
      ) : null}

      <p className="text-[12px] text-slate-400">
        Website visitors are unique first-party visitors from our own pageview log. Signups, email subscribers, and
        referrals come from their tables; searches, application clicks, and returning users come from session analytics.
        All counts are UTC.
      </p>
    </div>
  )
}
