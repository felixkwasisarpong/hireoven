"use client"

import { useCallback, useEffect, useState } from "react"
import { RefreshCw, Zap, DollarSign, AlertCircle, Database, TrendingUp, Clock } from "lucide-react"

type FeatureStats = {
  calls: number
  cachedCalls: number
  timedOutCalls: number
  failedCalls: number
  totalCostUsd: number
  avgLatencyMs: number
  totalInputTokens: number
  totalOutputTokens: number
}

type BudgetEntry = {
  feature: string
  model: string
  latencyMs: number
  costUsd: number
  success: boolean
  cached: boolean
  timedOut: boolean
  timestamp: number
}

type UsageData = {
  stats: {
    totalCalls: number
    cachedCalls: number
    timedOutCalls: number
    failedCalls: number
    cacheHitRate: number
    totalCostUsd: number
    avgLatencyMs: number
    p95LatencyMs: number
    byFeature: Record<string, FeatureStats>
  }
  cache: {
    size: number
    maxSize: number
    hits: number
    misses: number
    hitRate: number
  }
  slowest:   BudgetEntry[]
  expensive: BudgetEntry[]
  failed:    BudgetEntry[]
}

function fmt(ms: number) { return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s` }
function fmtCost(usd: number) { return usd < 0.01 ? `<$0.01` : `$${usd.toFixed(4)}` }
function ago(ts: number) {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ago`
}

function StatCard({ label, value, sub, icon: Icon, color = "text-slate-700" }: {
  label: string; value: string; sub?: string; icon: React.ElementType; color?: string
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
        <Icon className="h-4 w-4 text-slate-300" />
      </div>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-400">{sub}</p>}
    </div>
  )
}

function EntryRow({ entry, dim }: { entry: BudgetEntry; dim?: string }) {
  return (
    <div className="flex items-center gap-3 py-2 border-b border-slate-50 last:border-0 text-xs">
      <span className={`font-mono text-[10px] px-1.5 py-px rounded ${entry.cached ? "bg-emerald-50 text-emerald-700" : entry.timedOut ? "bg-amber-50 text-amber-700" : !entry.success ? "bg-red-50 text-red-700" : "bg-slate-100 text-slate-500"}`}>
        {entry.cached ? "CACHE" : entry.timedOut ? "TIMEOUT" : !entry.success ? "FAIL" : "OK"}
      </span>
      <span className="font-medium text-slate-700 w-40 truncate">{entry.feature}</span>
      <span className="text-slate-400 w-14 text-right">{dim === "cost" ? fmtCost(entry.costUsd) : fmt(entry.latencyMs)}</span>
      <span className="text-slate-300 font-mono text-[10px] truncate flex-1">{entry.model.split("-").slice(-2).join("-")}</span>
      <span className="text-slate-300 ml-auto">{ago(entry.timestamp)}</span>
    </div>
  )
}

export default function ScoutUsageDashboard() {
  const [data,    setData]    = useState<UsageData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res  = await fetch("/api/scout/usage")
      if (!res.ok) throw new Error(`${res.status}`)
      setData(await res.json() as UsageData)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const s = data?.stats
  const c = data?.cache

  return (
    <div className="min-h-screen bg-[#fafaf9] p-6">
      <div className="mx-auto max-w-5xl space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Scout Usage</h1>
            <p className="text-sm text-slate-400">AI cost · latency · cache — last 500 calls</p>
          </div>
          <button
            onClick={() => void load()}
            disabled={loading}
            className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            {error}
          </div>
        )}

        {/* Overview stats */}
        {s && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Total calls"    value={String(s.totalCalls)}                icon={Zap}       />
            <StatCard label="Cache hit rate" value={`${(s.cacheHitRate * 100).toFixed(0)}%`} icon={Database} color="text-emerald-700" sub={`${s.cachedCalls} cached`} />
            <StatCard label="Total cost"     value={fmtCost(s.totalCostUsd)}             icon={DollarSign} color="text-[#FF5C18]" />
            <StatCard label="Avg latency"    value={fmt(s.avgLatencyMs)}                 icon={Clock}     sub={`p95 ${fmt(s.p95LatencyMs)}`} color={s.avgLatencyMs > 8000 ? "text-red-700" : "text-slate-700"} />
          </div>
        )}

        {/* Secondary stats */}
        {s && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <StatCard label="Failed calls"  value={String(s.failedCalls)}    icon={AlertCircle} color={s.failedCalls > 0 ? "text-red-700" : "text-slate-400"} />
            <StatCard label="Timeouts"      value={String(s.timedOutCalls)}  icon={Clock}       color={s.timedOutCalls > 0 ? "text-amber-700" : "text-slate-400"} />
            {c && <StatCard label="Cache size" value={`${c.size}/${c.maxSize}`} icon={Database} sub={`${c.hits} hits · ${c.misses} misses`} />}
          </div>
        )}

        {/* By feature */}
        {s && Object.keys(s.byFeature).length > 0 && (
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-slate-400" />
              <span className="text-sm font-semibold text-slate-700">By feature</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50">
                    {["Feature","Calls","Cached","Timeouts","Failed","Avg latency","Total cost","Tokens in","Tokens out"].map((h) => (
                      <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-400">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(s.byFeature)
                    .sort((a, b) => b[1].totalCostUsd - a[1].totalCostUsd)
                    .map(([feature, f]) => (
                    <tr key={feature} className="border-b border-slate-50 hover:bg-slate-50">
                      <td className="px-3 py-2 font-medium text-slate-700">{feature}</td>
                      <td className="px-3 py-2 text-slate-500">{f.calls}</td>
                      <td className="px-3 py-2 text-emerald-600">{f.cachedCalls}</td>
                      <td className="px-3 py-2 text-amber-600">{f.timedOutCalls}</td>
                      <td className="px-3 py-2 text-red-600">{f.failedCalls}</td>
                      <td className="px-3 py-2 text-slate-500">{fmt(f.avgLatencyMs)}</td>
                      <td className="px-3 py-2 font-medium text-[#FF5C18]">{fmtCost(f.totalCostUsd)}</td>
                      <td className="px-3 py-2 text-slate-400">{f.totalInputTokens.toLocaleString()}</td>
                      <td className="px-3 py-2 text-slate-400">{f.totalOutputTokens.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Slowest + most expensive */}
        {data && (
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                <Clock className="h-4 w-4 text-amber-500" /> Slowest calls
              </p>
              {data.slowest.map((e, i) => <EntryRow key={i} entry={e} dim="latency" />)}
              {data.slowest.length === 0 && <p className="text-xs text-slate-300">No data yet</p>}
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-[#FF5C18]" /> Most expensive
              </p>
              {data.expensive.map((e, i) => <EntryRow key={i} entry={e} dim="cost" />)}
              {data.expensive.length === 0 && <p className="text-xs text-slate-300">No data yet</p>}
            </div>
          </div>
        )}

        {/* Failed calls */}
        {data && data.failed.length > 0 && (
          <div className="rounded-xl border border-red-200 bg-white p-4">
            <p className="text-sm font-semibold text-red-700 mb-3 flex items-center gap-2">
              <AlertCircle className="h-4 w-4" /> Failed / timed-out calls
            </p>
            {data.failed.map((e, i) => <EntryRow key={i} entry={e} />)}
          </div>
        )}
      </div>
    </div>
  )
}
