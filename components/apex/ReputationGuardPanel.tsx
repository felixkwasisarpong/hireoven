"use client"

import { useState } from "react"
import { Shield, ShieldAlert, ShieldCheck, ShieldX, Loader2, ExternalLink, TrendingUp } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ReputationGuardResult, ReputationDimension } from "@/lib/apex/reputation/scorer"

type Props = {
  companyName: string
  jobTitle?: string
  jobDescription?: string
  className?: string
}

const VERDICT_CONFIG = {
  trusted:   { icon: ShieldCheck, color: "text-emerald-600", bg: "bg-emerald-50", border: "border-emerald-200", label: "Trusted employer" },
  caution:   { icon: Shield,      color: "text-amber-600",   bg: "bg-amber-50",   border: "border-amber-200",   label: "Proceed with caution" },
  red_flag:  { icon: ShieldAlert, color: "text-red-600",     bg: "bg-red-50",     border: "border-red-200",     label: "Red flags detected" },
  unknown:   { icon: ShieldX,     color: "text-slate-500",   bg: "bg-slate-50",   border: "border-slate-100",   label: "Not enough data" },
}

const DIM_LABELS: Record<ReputationDimension, string> = {
  offer_integrity:   "Offer Integrity",
  interview_quality: "Interview Quality",
  tc_accuracy:       "TC Accuracy",
  culture_honesty:   "Culture Honesty",
}

function DimBar({ dim, score, max = 25 }: { dim: ReputationDimension; score: number; max?: number }) {
  const pct = Math.round((score / max) * 100)
  const color = pct >= 70 ? "bg-emerald-500" : pct >= 45 ? "bg-amber-500" : "bg-red-500"
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[12px] font-medium text-slate-700">{DIM_LABELS[dim]}</span>
        <span className="text-[11.5px] font-semibold text-slate-500">{score}/{max}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div className={cn("h-full rounded-full transition-all duration-700", color)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

export function ReputationGuardPanel({ companyName, jobTitle = "", jobDescription = "", className }: Props) {
  const [result, setResult] = useState<ReputationGuardResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function analyze() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/apex/reputation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyName, jobTitle, jobDescription }),
      })
      if (!res.ok) throw new Error()
      setResult(await res.json())
    } catch {
      setError("Analysis failed. Try again.")
    } finally {
      setLoading(false)
    }
  }

  const verdictCfg = result ? VERDICT_CONFIG[result.overallVerdict] : null
  const VerdictIcon = verdictCfg?.icon ?? Shield

  return (
    <div className={cn("rounded-2xl border border-indigo-100 bg-white shadow-sm", className)}>
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50">
          <Shield className="h-4 w-4 text-indigo-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-bold text-slate-900">Reputation Guard</p>
          <p className="text-[11px] text-slate-500">Know before you apply</p>
        </div>
        {!result && (
          <button
            type="button"
            onClick={analyze}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-full bg-indigo-600 px-3.5 py-1.5 text-[12px] font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <TrendingUp className="h-3.5 w-3.5" />}
            {loading ? "Analyzing…" : "Analyze"}
          </button>
        )}
      </div>

      {error && <p className="px-4 py-3 text-[12.5px] text-red-600">{error}</p>}

      {result && verdictCfg && (
        <div className="space-y-4 p-4">
          {/* Verdict hero */}
          <div className={cn("flex items-center gap-3 rounded-xl border p-3.5", verdictCfg.bg, verdictCfg.border)}>
            <VerdictIcon className={cn("h-5 w-5 flex-shrink-0", verdictCfg.color)} />
            <div className="flex-1 min-w-0">
              <p className={cn("text-[13px] font-bold", verdictCfg.color)}>{verdictCfg.label}</p>
              <p className="mt-0.5 text-[12px] leading-relaxed text-slate-700">{result.verdictSummary}</p>
            </div>
            <div className="text-center">
              <p className="text-[24px] font-black text-slate-800">{result.overallScore}</p>
              <p className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">/100</p>
            </div>
          </div>

          {/* Confidence */}
          {result.confidence < 0.5 && (
            <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11.5px] text-slate-500">
              ⚠ Limited data on {result.companyName}. Confidence: {Math.round(result.confidence * 100)}%. Use the research links below.
            </p>
          )}

          {/* Dimension bars */}
          <div className="space-y-2.5">
            {(Object.keys(result.breakdown) as ReputationDimension[]).map((dim) => (
              <DimBar key={dim} dim={dim} score={result.breakdown[dim].score} />
            ))}
          </div>

          {/* Watchouts */}
          {result.watchouts.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10.5px] font-semibold uppercase tracking-wide text-red-500">Watch out for</p>
              {result.watchouts.map((w, i) => (
                <div key={i} className="flex items-start gap-2 text-[12px] text-slate-700">
                  <span className="mt-0.5 h-2 w-2 flex-shrink-0 rounded-full bg-red-400" />
                  {w}
                </div>
              ))}
            </div>
          )}

          {/* Green lights */}
          {result.greenLights.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10.5px] font-semibold uppercase tracking-wide text-emerald-600">Green lights</p>
              {result.greenLights.map((g, i) => (
                <div key={i} className="flex items-start gap-2 text-[12px] text-slate-700">
                  <span className="mt-0.5 h-2 w-2 flex-shrink-0 rounded-full bg-emerald-400" />
                  {g}
                </div>
              ))}
            </div>
          )}

          {/* Research links */}
          <div className="border-t border-slate-100 pt-3">
            <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">Dig deeper</p>
            <div className="flex flex-wrap gap-2">
              {result.researchLinks.map((link) => (
                <a
                  key={link.url}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[11px] font-medium text-indigo-700 transition hover:bg-indigo-100"
                >
                  {link.label}
                  <ExternalLink className="h-2.5 w-2.5 opacity-60" />
                </a>
              ))}
            </div>
          </div>

          <button type="button" onClick={() => setResult(null)}
            className="text-[11px] text-indigo-400 hover:text-indigo-600 hover:underline">
            Re-analyze
          </button>
        </div>
      )}
    </div>
  )
}
