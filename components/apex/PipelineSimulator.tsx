"use client"

import { useEffect, useState } from "react"
import { Loader2, TrendingUp, AlertCircle, Zap } from "lucide-react"
import { cn } from "@/lib/utils"
import type { SimulationResult, FunnelMetrics } from "@/lib/apex/pipeline-sim/simulator"

type Props = {
  /** Pre-filled metrics (from user's application data). Falls back to a manual form. */
  initialMetrics?: Partial<FunnelMetrics>
  className?: string
}

const BOTTLENECK_LABELS = {
  application_response: "Resume / targeting",
  phone_to_onsite:      "Phone screen",
  onsite_to_offer:      "Final round",
  none_yet:             "No bottleneck yet",
}

function ProbabilityBar({ week, probability }: { week: number; probability: number }) {
  const pct = Math.round(probability * 100)
  const color = pct >= 70 ? "bg-emerald-500" : pct >= 40 ? "bg-indigo-500" : "bg-slate-300"
  return (
    <div className="flex items-center gap-2">
      <span className="w-12 text-right text-[11px] font-medium text-slate-500">Wk {week}</span>
      <div className="flex-1 h-2.5 rounded-full bg-slate-100 overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all duration-700", color)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={cn("w-9 text-right text-[12px] font-semibold tabular-nums",
        pct >= 70 ? "text-emerald-600" : pct >= 40 ? "text-indigo-600" : "text-slate-400"
      )}>{pct}%</span>
    </div>
  )
}

function FunnelField({
  label, value, onChange,
}: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">{label}</label>
      <input
        type="number"
        min={0}
        value={value}
        onChange={(e) => onChange(Math.max(0, parseInt(e.target.value) || 0))}
        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] font-semibold text-slate-800 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
      />
    </div>
  )
}

export function PipelineSimulator({ initialMetrics, className }: Props) {
  const [metrics, setMetrics] = useState<FunnelMetrics>({
    applicationsSent:  initialMetrics?.applicationsSent  ?? 0,
    responsesReceived: initialMetrics?.responsesReceived ?? 0,
    phoneScreens:      initialMetrics?.phoneScreens      ?? 0,
    onsiteInterviews:  initialMetrics?.onsiteInterviews   ?? 0,
    offersReceived:    initialMetrics?.offersReceived     ?? 0,
    appsPerWeek:       initialMetrics?.appsPerWeek        ?? 5,
    weeksElapsed:      initialMetrics?.weeksElapsed       ?? 0,
  })
  const [result, setResult] = useState<SimulationResult | null>(null)
  const [loading, setLoading] = useState(false)

  async function simulate() {
    setLoading(true)
    try {
      const res = await fetch("/api/apex/pipeline-sim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(metrics),
      })
      if (res.ok) setResult(await res.json())
    } finally {
      setLoading(false)
    }
  }

  // Auto-load from user's real data on mount
  useEffect(() => {
    fetch("/api/apex/pipeline-sim")
      .then((r) => r.json())
      .then((data) => {
        if (data.metrics) setMetrics(data.metrics)
        if (data.simulation) setResult(data.simulation)
      })
      .catch(() => {})
  }, [])

  const set = (key: keyof FunnelMetrics) => (v: number) => setMetrics((m) => ({ ...m, [key]: v }))

  return (
    <div className={cn("rounded-2xl border border-indigo-100 bg-white shadow-sm", className)}>
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50">
          <TrendingUp className="h-4 w-4 text-indigo-600" />
        </div>
        <div className="flex-1">
          <p className="text-[13px] font-bold text-slate-900">Pipeline Simulator</p>
          <p className="text-[11px] text-slate-500">Monte Carlo probability of your next offer</p>
        </div>
      </div>

      <div className="space-y-4 p-4">
        {/* Funnel inputs */}
        <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-6">
          <FunnelField label="Applied"    value={metrics.applicationsSent}  onChange={set("applicationsSent")} />
          <FunnelField label="Responses"  value={metrics.responsesReceived} onChange={set("responsesReceived")} />
          <FunnelField label="Phones"     value={metrics.phoneScreens}      onChange={set("phoneScreens")} />
          <FunnelField label="Onsites"    value={metrics.onsiteInterviews}  onChange={set("onsiteInterviews")} />
          <FunnelField label="Offers"     value={metrics.offersReceived}    onChange={set("offersReceived")} />
          <FunnelField label="Apps/wk"   value={metrics.appsPerWeek}       onChange={set("appsPerWeek")} />
        </div>

        <button
          type="button"
          onClick={simulate}
          disabled={loading}
          className="w-full rounded-xl bg-indigo-600 py-2.5 text-[13px] font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-60"
        >
          {loading ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : "Run simulation"}
        </button>

        {result && (
          <>
            {/* Headline stat */}
            <div className={cn(
              "flex items-center gap-4 rounded-xl border p-4",
              result.momentumScore >= 65 ? "border-emerald-200 bg-emerald-50"
              : result.momentumScore >= 40 ? "border-indigo-200 bg-indigo-50"
              : "border-amber-200 bg-amber-50"
            )}>
              <div className="text-center">
                <p className="text-[32px] font-black leading-none text-slate-800">
                  {result.medianWeeksToOffer === -1 ? "52+" : result.medianWeeksToOffer}
                </p>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">weeks (median)</p>
              </div>
              <div className="flex-1 min-w-0 border-l border-slate-200/60 pl-4">
                <p className="text-[13px] font-semibold text-slate-800">
                  {Math.round((result.offerProbabilityByWeek[8] ?? 0) * 100)}% chance of offer in 8 weeks
                </p>
                <p className="mt-0.5 text-[11.5px] text-slate-500">
                  Range: {result.confidenceInterval.low}–{result.confidenceInterval.high} weeks
                  · {result.estimatedAppsNeeded} total apps needed
                </p>
                <p className={cn(
                  "mt-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-bold",
                  result.momentumScore >= 65 ? "bg-emerald-100 text-emerald-700"
                  : result.momentumScore >= 40 ? "bg-indigo-100 text-indigo-700"
                  : "bg-amber-100 text-amber-700"
                )}>
                  <Zap className="h-3 w-3" />
                  Momentum: {result.momentumLabel} ({result.momentumScore}/100)
                </p>
              </div>
            </div>

            {/* Bottleneck */}
            {result.bottleneck !== "none_yet" && (
              <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
                <div>
                  <p className="text-[12.5px] font-semibold text-amber-800">
                    Bottleneck: {BOTTLENECK_LABELS[result.bottleneck]}
                  </p>
                  <p className="mt-0.5 text-[12px] text-amber-700">{result.bottleneckExplanation}</p>
                </div>
              </div>
            )}

            {/* Probability chart */}
            <div>
              <p className="mb-2.5 text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">
                Probability of offer by week
              </p>
              <div className="space-y-1.5">
                {[2, 4, 6, 8, 10, 12].map((w) => (
                  <ProbabilityBar key={w} week={w} probability={result.offerProbabilityByWeek[w] ?? 0} />
                ))}
              </div>
            </div>

            {/* What-if scenarios */}
            <div className="grid grid-cols-2 gap-2.5">
              <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-indigo-600">If you apply more</p>
                <p className="mt-1 text-[12px] text-slate-700">{result.scenarioBoost.label}</p>
              </div>
              <div className="rounded-xl border border-violet-200 bg-violet-50 p-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-violet-600">If you target better</p>
                <p className="mt-1 text-[12px] text-slate-700">{result.scenarioQuality.label}</p>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
