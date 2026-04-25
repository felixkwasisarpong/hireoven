"use client"

import { Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

type MatchBadgeProps = {
  score: number | null
  loading?: boolean
  /** When true renders as a compact inline pill; default renders the arc gauge column */
  compact?: boolean
  className?: string
}

function scoreColor(score: number) {
  if (score >= 80) {
    return {
      gauge: "#22c55e",
      gaugeSoft: "#dcfce7",
      text: "text-emerald-700",
      ring: "ring-emerald-200 bg-emerald-50",
      glow: "shadow-[0_0_0_3px_rgba(34,197,94,0.08)]",
    }
  }
  if (score >= 60) {
    return {
      gauge: "#3b82f6",
      gaugeSoft: "#dbeafe",
      text: "text-blue-700",
      ring: "ring-blue-200 bg-blue-50",
      glow: "shadow-[0_0_0_3px_rgba(59,130,246,0.08)]",
    }
  }
  if (score >= 40) {
    return {
      gauge: "#f97316",
      gaugeSoft: "#ffedd5",
      text: "text-orange-700",
      ring: "ring-orange-200 bg-orange-50",
      glow: "shadow-[0_0_0_3px_rgba(249,115,22,0.08)]",
    }
  }
  return {
    gauge: "#94a3b8",
    gaugeSoft: "#f1f5f9",
    text: "text-slate-600",
    ring: "ring-slate-200 bg-slate-50",
    glow: "shadow-[0_0_0_3px_rgba(100,116,139,0.08)]",
  }
}

export function MatchBadge({ score, loading, compact, className }: MatchBadgeProps) {
  if (loading) {
    return compact ? (
      <span className={cn("inline-flex items-center gap-2 rounded-full ring-1 ring-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-400", className)}>
        <span className="grid h-8 w-8 place-items-center rounded-full bg-slate-100">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        </span>
        <span>Match</span>
      </span>
    ) : (
      <div className={cn("flex flex-col items-center gap-1", className)}>
        <div className="h-10 w-16 animate-pulse rounded-lg bg-slate-200/80" />
        <div className="h-2 w-14 animate-pulse rounded-full bg-slate-200/80" />
      </div>
    )
  }

  if (score === null) return null

  const colors = scoreColor(score)

  if (compact) {
    const pct = Math.min(100, Math.max(0, score))
    return (
      <span
        className={cn(
          "inline-flex items-center gap-2 rounded-full px-2 py-1 ring-1 transition-transform duration-200 group-hover:scale-[1.01]",
          colors.ring,
          colors.text,
          colors.glow,
          className
        )}
      >
        <span
          className="relative grid h-8 w-8 place-items-center rounded-full"
          style={{
            background: `conic-gradient(${colors.gauge} ${pct * 3.6}deg, ${colors.gaugeSoft} 0deg)`,
          }}
          aria-hidden
        >
          <span className="absolute inset-[4px] rounded-full bg-white" />
          <span className="relative text-[10px] font-extrabold leading-none tabular-nums text-slate-900">
            {score}
          </span>
        </span>
        <span className="flex flex-col items-start leading-none">
          <span className="text-[11px] font-bold">Match</span>
          <span className="mt-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] opacity-70">
            score
          </span>
        </span>
      </span>
    )
  }

  const r = 28
  const c = Math.PI * r
  const pct = Math.min(100, Math.max(0, score)) / 100

  return (
    <div className={cn("flex flex-col items-center", className)}>
      <div className="relative h-[50px] w-[76px]">
        <svg width="76" height="50" viewBox="0 0 76 50" aria-hidden>
          <path d="M 10 42 A 28 28 0 0 1 66 42" fill="none" stroke="#e2e8f0" strokeWidth="6" strokeLinecap="round" />
          <path
            d="M 10 42 A 28 28 0 0 1 66 42"
            fill="none"
            stroke={colors.gauge}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={`${pct * c} ${c}`}
          />
        </svg>
        <span className={cn("absolute bottom-0 left-1/2 -translate-x-1/2 text-[1.35rem] font-bold leading-none text-slate-900")}>
          {score}
          <span className="text-xs font-semibold text-slate-500">%</span>
        </span>
      </div>
      <p className="mt-0.5 text-[11px] font-medium text-slate-600">Match Score</p>
    </div>
  )
}
