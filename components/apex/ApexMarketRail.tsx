"use client"

import { TrendingUp, TrendingDown, AlertTriangle, Info, ChevronDown, ChevronUp } from "lucide-react"
import { useState } from "react"
import { cn } from "@/lib/utils"
import type { MarketSignal } from "@/lib/scout/market-intelligence"

// ── Per-signal style ──────────────────────────────────────────────────────────

const SEVERITY_STYLE = {
  warning:  { dot: "bg-amber-400",   text: "text-amber-700",  icon: AlertTriangle },
  positive: { dot: "bg-[#FF5C18]",   text: "text-[#c94010]",  icon: TrendingUp    },
  info:     { dot: "bg-slate-300",   text: "text-slate-500",  icon: Info          },
} as const

// ── Component ─────────────────────────────────────────────────────────────────

type Props = {
  signals: MarketSignal[]
  loading?: boolean
}

function ConfidencePip({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100)
  const color =
    pct >= 70 ? "bg-slate-400" :
    pct >= 50 ? "bg-slate-300" :
               "bg-slate-200"
  return (
    <span
      title={`${pct}% confidence`}
      className={cn("inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full", color)}
    />
  )
}

function SignalRow({ signal }: { signal: MarketSignal }) {
  const [expanded, setExpanded] = useState(false)
  const style = SEVERITY_STYLE[signal.severity] ?? SEVERITY_STYLE.info
  const Icon = style.icon

  return (
    <div className="group">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-start gap-2.5 py-2.5 text-left"
      >
        <span className={cn("mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full", style.dot)} />
        <div className="min-w-0 flex-1">
          <span className="text-[12px] font-semibold leading-5 text-slate-900">
            {signal.title}
          </span>
        </div>
        <div className="flex flex-shrink-0 items-center gap-1.5 pt-0.5">
          <ConfidencePip confidence={signal.confidence} />
          {expanded
            ? <ChevronUp className="h-3 w-3 text-slate-400" />
            : <ChevronDown className="h-3 w-3 text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity" />
          }
        </div>
      </button>

      {expanded && (
        <div className="ml-[18px] pb-2.5">
          <p className="text-[11px] leading-4.5 text-slate-500">{signal.summary}</p>
          <span className={cn("mt-1 inline-flex items-center gap-1 text-[10px] font-semibold", style.text)}>
            <Icon className="h-2.5 w-2.5" />
            {Math.round(signal.confidence * 100)}% confidence · based on your data
          </span>
        </div>
      )}
    </div>
  )
}

export function ScoutMarketRail({ signals, loading = false }: Props) {
  if (loading) {
    return (
      <div className="space-y-2.5 py-1">
        {[1, 2].map((i) => (
          <div key={i} className="flex items-start gap-2.5">
            <span className="mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-slate-200" />
            <div className="h-3 w-40 animate-pulse rounded bg-slate-100" />
          </div>
        ))}
      </div>
    )
  }

  if (signals.length === 0) return null

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_2px_12px_rgba(15,23,42,0.06)]">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
        <TrendingUp className="h-3.5 w-3.5 flex-shrink-0 text-[#FF5C18]" />
        <p className="text-[10.5px] font-semibold uppercase tracking-widest text-slate-400">
          Market signals
        </p>
      </div>

      {/* Signal list */}
      <div className="divide-y divide-slate-50 px-4">
        {signals.map((signal) => (
          <SignalRow key={signal.id} signal={signal} />
        ))}
      </div>

      {/* Footer note */}
      <div className="border-t border-slate-100 px-4 py-2">
        <p className="text-[10px] text-slate-400">
          Based on your saved targets · confidence varies by sample size
        </p>
      </div>
    </div>
  )
}
