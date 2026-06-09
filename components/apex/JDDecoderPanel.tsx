"use client"

import { useState } from "react"
import { AlertTriangle, CheckCircle2, Info, Loader2, Scan, ChevronDown, ChevronUp, Eye } from "lucide-react"
import { cn } from "@/lib/utils"
import { ApexIcon } from "@/components/apex/ApexIcon"
import type { JDDecodeResult, RedFlag } from "@/lib/apex/jd-decoder/analyzer"

type Props = {
  jobId?: string
  title: string
  description: string
  resumeSummary?: string
  className?: string
}

const SEVERITY_CONFIG = {
  critical: { icon: AlertTriangle, color: "text-red-600",    bg: "bg-red-50",    border: "border-red-200",    label: "Critical" },
  warning:  { icon: AlertTriangle, color: "text-amber-600",  bg: "bg-amber-50",  border: "border-amber-200",  label: "Warning"  },
  note:     { icon: Info,          color: "text-slate-500",  bg: "bg-slate-50",  border: "border-slate-200",  label: "Note"     },
}

const POSTING_TYPE_LABELS: Record<string, { label: string; color: string; detail: string }> = {
  growth:     { label: "Growth hire",     color: "text-emerald-700 bg-emerald-50 border-emerald-200", detail: "Net-new headcount — real opening" },
  backfill:   { label: "Backfill",        color: "text-amber-700 bg-amber-50 border-amber-200",       detail: "Replacing someone who left" },
  evergreen:  { label: "Evergreen post",  color: "text-orange-700 bg-orange-50 border-orange-200",    detail: "Always-open, may have high churn" },
  compliance: { label: "Compliance post", color: "text-red-700 bg-red-50 border-red-200",             detail: "Possibly already filled internally" },
  unknown:    { label: "Unknown",         color: "text-slate-600 bg-slate-50 border-slate-200",       detail: "Not enough signals to classify" },
}

function ScoreRing({ score }: { score: number }) {
  const color = score >= 70 ? "#22c55e" : score >= 45 ? "#f59e0b" : "#ef4444"
  const r = 22, circ = 2 * Math.PI * r
  const dash = (score / 100) * circ
  return (
    <div className="relative flex h-16 w-16 items-center justify-center">
      <svg width="64" height="64" className="-rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" stroke="#e2e8f0" strokeWidth="5" />
        <circle cx="32" cy="32" r={r} fill="none" stroke={color} strokeWidth="5"
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
          style={{ transition: "stroke-dasharray 0.8s ease" }} />
      </svg>
      <span className="absolute text-[15px] font-bold text-slate-800">{score}</span>
    </div>
  )
}

function FlagCard({ flag }: { flag: RedFlag }) {
  const cfg = SEVERITY_CONFIG[flag.severity]
  const Icon = cfg.icon
  return (
    <div className={cn("flex gap-3 rounded-xl border p-3", cfg.bg, cfg.border)}>
      <Icon className={cn("mt-0.5 h-4 w-4 flex-shrink-0", cfg.color)} />
      <div className="min-w-0">
        <p className={cn("text-[12px] font-semibold", cfg.color)}>{flag.label}</p>
        <p className="mt-0.5 text-[11.5px] text-slate-600">{flag.explanation}</p>
        {flag.excerpt && (
          <p className="mt-1.5 rounded bg-white/70 px-2 py-1 font-mono text-[10.5px] text-slate-500 italic">
            "{flag.excerpt}"
          </p>
        )}
      </div>
    </div>
  )
}

export function JDDecoderPanel({ title, description, resumeSummary, className }: Props) {
  const [result, setResult] = useState<JDDecodeResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)

  async function decode() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/apex/jd-decode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, description, resumeSummary }),
      })
      if (!res.ok) throw new Error("Analysis failed")
      setResult(await res.json())
    } catch {
      setError("Apex couldn't decode this JD. Try again.")
    } finally {
      setLoading(false)
    }
  }

  const criticalFlags = result?.redFlags.filter((f) => f.severity === "critical") ?? []
  const otherFlags    = result?.redFlags.filter((f) => f.severity !== "critical") ?? []
  const postingCfg    = result ? POSTING_TYPE_LABELS[result.postingType] : null

  return (
    <div className={cn("rounded-2xl border border-slate-100 bg-white shadow-sm", className)}>
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-50">
          <Scan className="h-4 w-4 text-slate-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-bold text-slate-900">JD Decoder</p>
          <p className="text-[11px] text-slate-500">Apex reads between the lines</p>
        </div>
        {!result && (
          <button
            type="button"
            onClick={decode}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-full bg-slate-600 px-3.5 py-1.5 text-[12px] font-semibold text-white shadow-sm transition hover:bg-slate-700 disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
            {loading ? "Decoding…" : "Decode"}
          </button>
        )}
      </div>

      {error && (
        <p className="px-4 py-3 text-[12.5px] text-red-600">{error}</p>
      )}

      {result && (
        <div className="space-y-4 p-4">
          {/* TLDR + score */}
          <div className="flex items-start gap-4">
            <ScoreRing score={result.overallScore} />
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Apex verdict</p>
              <p className="mt-1 text-[13px] leading-relaxed text-slate-800 italic">"{result.tldr}"</p>
            </div>
          </div>

          {/* Posting type + seniority */}
          <div className="flex flex-wrap gap-2">
            {postingCfg && (
              <span className={cn("inline-flex items-center rounded-full border px-3 py-1 text-[11.5px] font-semibold", postingCfg.color)}>
                {postingCfg.label} · {postingCfg.detail}
              </span>
            )}
            {result.seniority.mismatch && (
              <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-3 py-1 text-[11.5px] font-semibold text-red-700">
                <AlertTriangle className="h-3 w-3" />
                Seniority bait-and-switch
              </span>
            )}
            <span className={cn(
              "inline-flex items-center rounded-full border px-3 py-1 text-[11.5px] font-semibold",
              result.urgencySignal === "high" ? "border-green-200 bg-green-50 text-green-700"
              : result.urgencySignal === "low" ? "border-slate-200 bg-slate-50 text-slate-600"
              : "border-sky-200 bg-sky-50 text-sky-700"
            )}>
              Urgency: {result.urgencySignal}
            </span>
          </div>

          {/* Red flags */}
          {result.redFlags.length > 0 && (
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Red flags ({result.redFlags.length})
              </p>
              {criticalFlags.map((f) => <FlagCard key={f.id} flag={f} />)}
              {(showAll ? otherFlags : otherFlags.slice(0, 2)).map((f) => <FlagCard key={f.id} flag={f} />)}
              {otherFlags.length > 2 && (
                <button type="button" onClick={() => setShowAll((v) => !v)}
                  className="flex items-center gap-1 text-[11.5px] font-medium text-slate-600 hover:underline">
                  {showAll ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  {showAll ? "Show less" : `Show ${otherFlags.length - 2} more`}
                </button>
              )}
            </div>
          )}

          {/* Green signals */}
          {result.greenSignals.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Green lights</p>
              {result.greenSignals.map((g, i) => (
                <div key={i} className="flex items-center gap-2 text-[12.5px] text-emerald-700">
                  <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0 text-emerald-500" />
                  {g}
                </div>
              ))}
            </div>
          )}

          {/* Must-haves vs nice-to-haves */}
          {(result.mustHaves.length > 0 || result.niceToHaves.length > 0) && (
            <div className="grid grid-cols-2 gap-3">
              {result.mustHaves.length > 0 && (
                <div>
                  <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-red-500">Must-haves</p>
                  <ul className="space-y-1">
                    {result.mustHaves.slice(0, 5).map((m, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-[12px] text-slate-700">
                        <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-red-400" />
                        {m}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {result.niceToHaves.length > 0 && (
                <div>
                  <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">Nice-to-haves</p>
                  <ul className="space-y-1">
                    {result.niceToHaves.slice(0, 5).map((n, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-[12px] text-slate-500 line-through decoration-slate-300">
                        <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-slate-300" />
                        <span className="no-underline not-italic text-slate-400">{n}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Hidden expectations */}
          {result.hiddenExpectations.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
              <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-wide text-amber-700">Hidden expectations Apex detected</p>
              <ul className="space-y-1.5">
                {result.hiddenExpectations.map((h, i) => (
                  <li key={i} className="flex items-start gap-2 text-[12px] text-amber-800">
                    <span className="mt-1 text-amber-500">⚠</span> {h}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <button type="button" onClick={() => setResult(null)}
            className="text-[11px] text-slate-400 hover:text-slate-600 hover:underline">
            Re-decode
          </button>
        </div>
      )}
    </div>
  )
}
