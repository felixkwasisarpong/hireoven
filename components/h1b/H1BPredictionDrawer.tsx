"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import {
  ArrowDown,
  ArrowUp,
  Lock,
  Loader2,
  Minus,
  Sparkles,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useSubscription } from "@/lib/hooks/useSubscription"
import type { H1BPrediction, H1BVerdict, PredictionSignal } from "@/types"

type Props = {
  jobId: string
  jobTitle: string
  companyName: string
  prediction: H1BPrediction | null
  isLoading: boolean
  onClose: () => void
}

const VERDICT_COPY: Record<H1BVerdict, { label: string; accent: string; ring: string }> = {
  strong: {
    label: "Strong",
    accent: "text-emerald-700",
    ring: "stroke-emerald-500",
  },
  good: { label: "Good", accent: "text-cyan-700", ring: "stroke-cyan-500" },
  moderate: {
    label: "Moderate",
    accent: "text-amber-700",
    ring: "stroke-amber-500",
  },
  risky: { label: "Risky", accent: "text-red-700", ring: "stroke-red-500" },
  unknown: {
    label: "Unknown",
    accent: "text-slate-600",
    ring: "stroke-slate-400",
  },
}

function ScoreRing({ value, verdict }: { value: number; verdict: H1BVerdict }) {
  const clamped = Math.max(0, Math.min(100, value))
  const circumference = 2 * Math.PI * 48
  const dash = (clamped / 100) * circumference
  const verdictStyle = VERDICT_COPY[verdict]
  return (
    <div className="relative h-28 w-28 flex-shrink-0">
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
        <circle cx="60" cy="60" r="48" className="fill-none stroke-slate-100" strokeWidth="10" />
        <circle
          cx="60"
          cy="60"
          r="48"
          strokeWidth="10"
          className={cn("fill-none transition-[stroke-dashoffset] duration-700", verdictStyle.ring)}
          strokeDasharray={`${dash} ${circumference}`}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={cn("text-3xl font-semibold tabular-nums", verdictStyle.accent)}>
          ~{clamped}%
        </span>
        <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">
          approval
        </span>
      </div>
    </div>
  )
}

function ImpactIcon({ impact }: { impact: PredictionSignal["impact"] }) {
  if (impact === "positive") return <ArrowUp className="h-4 w-4 text-emerald-600" />
  if (impact === "negative") return <ArrowDown className="h-4 w-4 text-red-600" />
  return <Minus className="h-4 w-4 text-slate-400" />
}

function WeightBadge({ weight }: { weight: PredictionSignal["weight"] }) {
  const label =
    weight === "high" ? "High impact" : weight === "medium" ? "Medium impact" : "Low impact"
  const style =
    weight === "high"
      ? "border-slate-300 bg-slate-100 text-slate-700"
      : weight === "medium"
        ? "border-slate-200 bg-slate-50 text-slate-600"
        : "border-slate-200 bg-white text-slate-500"
  return (
    <span className={cn("rounded border px-1.5 py-0.5 text-[10px] font-semibold", style)}>
      {label}
    </span>
  )
}

function YearBars({ statsByYear }: { statsByYear: Record<string, { rate: number; total: number }> }) {
  const years = Object.entries(statsByYear)
    .map(([y, v]) => ({ year: Number(y), rate: v.rate, total: v.total }))
    .filter((x) => Number.isFinite(x.year))
    .sort((a, b) => a.year - b.year)
    .slice(-3)

  if (years.length === 0) return null

  return (
    <div className="space-y-2">
      {years.map((y) => (
        <div key={y.year} className="flex items-center gap-3">
          <span className="w-10 text-xs font-semibold tabular-nums text-slate-500">
            {y.year}
          </span>
          <div className="relative h-2 flex-1 rounded-full bg-slate-100">
            <div
              className="absolute left-0 top-0 h-2 rounded-full bg-emerald-500"
              style={{ width: `${Math.round(y.rate * 100)}%` }}
            />
          </div>
          <span className="w-12 text-right text-xs font-medium tabular-nums text-slate-600">
            {Math.round(y.rate * 100)}%
          </span>
          <span className="w-14 text-right text-[11px] tabular-nums text-slate-400">
            n={y.total}
          </span>
        </div>
      ))}
    </div>
  )
}

export default function H1BPredictionDrawer({
  jobId,
  jobTitle,
  companyName,
  prediction,
  isLoading,
  onClose,
}: Props) {
  const { isProInternational } = useSubscription()
  const [deepAnalysis, setDeepAnalysis] = useState<string | null>(null)
  const [deepLoading, setDeepLoading] = useState(false)
  const [deepError, setDeepError] = useState<string | null>(null)

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onEsc)
    return () => window.removeEventListener("keydown", onEsc)
  }, [onClose])

  const verdictCopy = prediction ? VERDICT_COPY[prediction.verdict] : VERDICT_COPY.unknown

  const statsByYear = useMemo(() => {
    // NOTE: full yearly stats live on the employer stats table. For the
    // drawer we fall back to whatever is in the prediction cache. To expose
    // the full chart we'd hydrate from /api/h1b/predict/stats - kept minimal
    // here to avoid round trips on drawer open.
    return {}
  }, [])

  async function runDeepAnalysis() {
    if (!isProInternational) return
    setDeepLoading(true)
    setDeepError(null)
    try {
      const res = await fetch("/api/h1b/predict/deep", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Deep analysis failed" }))
        setDeepError((body?.error as string) ?? "Deep analysis failed")
        return
      }
      const data = (await res.json()) as { analysis?: string }
      if (data.analysis) setDeepAnalysis(data.analysis)
    } catch (err) {
      setDeepError((err as Error).message ?? "Deep analysis failed")
    } finally {
      setDeepLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        aria-label="Close"
        type="button"
        className="absolute inset-0 bg-slate-900/40"
        onClick={onClose}
      />
      <aside className="relative h-full w-full max-w-md overflow-y-auto border-l border-slate-200 bg-white shadow-xl sm:w-[28rem]">
        {/* Header */}
        <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-slate-100 bg-white/95 px-5 py-4 backdrop-blur">
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
              H1B approval prediction
            </p>
            <h2 className="mt-0.5 truncate text-base font-semibold text-slate-900">
              {jobTitle}
            </h2>
            <p className="mt-0.5 truncate text-xs text-slate-500">{companyName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="-mr-1.5 rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close drawer"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="space-y-6 px-5 py-5">
          {/* Disclaimer */}
          <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-500">
            Based on DOL LCA data and historical patterns. Not legal advice -
            consult an immigration attorney for case-specific guidance.
          </p>

          {/* Overall score */}
          {isLoading || !prediction ? (
            <div className="flex items-center gap-4">
              <div className="h-28 w-28 animate-pulse rounded-full bg-slate-100" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-20 animate-pulse rounded bg-slate-100" />
                <div className="h-3 w-32 animate-pulse rounded bg-slate-100" />
                <div className="h-3 w-24 animate-pulse rounded bg-slate-100" />
              </div>
            </div>
          ) : (
            <section className="flex items-center gap-5">
              <ScoreRing value={prediction.approvalLikelihood} verdict={prediction.verdict} />
              <div className="min-w-0 flex-1 space-y-1">
                <p className={cn("text-xl font-semibold", verdictCopy.accent)}>
                  {verdictCopy.label}
                </p>
                <p className="text-sm leading-6 text-slate-600">{prediction.summary}</p>
                <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-400">
                  Prediction confidence: {prediction.confidenceLevel}
                  {prediction.confidenceLevel === "low" && " - limited data"}
                </p>
              </div>
            </section>
          )}

          {/* Signals */}
          {prediction && prediction.signals.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                Key signals
              </h3>
              <ul className="space-y-2">
                {prediction.signals.map((signal, idx) => (
                  <li
                    key={`${signal.factor}-${idx}`}
                    className="flex gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5"
                  >
                    <ImpactIcon impact={signal.impact} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-slate-800">
                          {signal.factor}
                        </span>
                        <WeightBadge weight={signal.weight} />
                      </div>
                      <p className="mt-0.5 text-xs leading-5 text-slate-600">
                        {signal.detail}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Employer data */}
          {prediction?.employerStats ? (
            <section className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
              <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                {companyName} H1B history
              </h3>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-md bg-white px-3 py-2 ring-1 ring-inset ring-slate-200">
                  <p className="text-[11px] uppercase tracking-[0.1em] text-slate-400">
                    Total apps
                  </p>
                  <p className="text-base font-semibold text-slate-800 tabular-nums">
                    {prediction.employerStats.totalApplications.toLocaleString()}
                  </p>
                </div>
                <div className="rounded-md bg-white px-3 py-2 ring-1 ring-inset ring-slate-200">
                  <p className="text-[11px] uppercase tracking-[0.1em] text-slate-400">
                    Approval rate
                  </p>
                  <p className="text-base font-semibold text-slate-800 tabular-nums">
                    {Math.round(prediction.employerStats.certificationRate * 100)}%
                  </p>
                </div>
                <div className="rounded-md bg-white px-3 py-2 ring-1 ring-inset ring-slate-200">
                  <p className="text-[11px] uppercase tracking-[0.1em] text-slate-400">
                    Trend
                  </p>
                  <p className="text-base font-semibold capitalize text-slate-800">
                    {prediction.employerStats.trend ?? "stable"}
                  </p>
                </div>
                <div className="rounded-md bg-white px-3 py-2 ring-1 ring-inset ring-slate-200">
                  <p className="text-[11px] uppercase tracking-[0.1em] text-slate-400">
                    Years of data
                  </p>
                  <p className="text-sm font-semibold text-slate-800 tabular-nums">
                    {prediction.employerStats.dataYears.length > 0
                      ? `${prediction.employerStats.dataYears[0]} – ${
                          prediction.employerStats.dataYears[
                            prediction.employerStats.dataYears.length - 1
                          ]
                        }`
                      : "-"}
                  </p>
                </div>
              </div>
              <YearBars statsByYear={statsByYear as Record<string, { rate: number; total: number }>} />
            </section>
          ) : prediction && prediction.missingEmployerData ? (
            <section className="rounded-lg border border-slate-200 bg-white p-3 text-xs leading-5 text-slate-500">
              No LCA records found for {companyName}. They may file under a
              different legal name or have limited H1B history.
            </section>
          ) : null}

          {/* Missing salary note */}
          {prediction?.missingSalary && prediction.isUSJob && (
            <section className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800">
              Salary isn&apos;t disclosed in this listing. Wage level is a
              critical H1B approval factor. If you receive an offer, verify
              the salary is at or above the prevailing wage for this role and
              location.
            </section>
          )}

          {/* Deep analysis */}
          <section className="space-y-2 border-t border-slate-100 pt-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                Deep H1B analysis
              </h3>
              {!isProInternational && <Lock className="h-3.5 w-3.5 text-slate-400" />}
            </div>

            {isProInternational ? (
              <>
                {deepAnalysis ? (
                  <div className="whitespace-pre-wrap rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm leading-6 text-slate-700">
                    {deepAnalysis}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => void runDeepAnalysis()}
                    disabled={deepLoading || !prediction}
                    className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {deepLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Sparkles className="h-4 w-4" />
                    )}
                    {deepLoading ? "Analysing…" : "Run deep H1B analysis"}
                  </button>
                )}
                {deepError && (
                  <p className="text-xs text-red-600">{deepError}</p>
                )}
              </>
            ) : (
              <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                <p>
                  Upgrade to Pro International for AI-powered detailed H1B
                  assessment - employer context, SOC fit, wage-level risk, and
                  specific recommendations.
                </p>
                <Link
                  href="/dashboard/upgrade?plan=pro_international"
                  className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
                >
                  Upgrade to Pro International
                </Link>
              </div>
            )}
          </section>
        </div>
      </aside>
    </div>
  )
}
