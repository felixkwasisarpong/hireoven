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
  if (score >= 80) return { gauge: "#22c55e", text: "text-emerald-700", ring: "ring-emerald-200 bg-emerald-50" }
  if (score >= 60) return { gauge: "#3b82f6", text: "text-blue-700", ring: "ring-blue-200 bg-blue-50" }
  if (score >= 40) return { gauge: "#f97316", text: "text-orange-700", ring: "ring-orange-200 bg-orange-50" }
  return { gauge: "#e2e8f0", text: "text-slate-500", ring: "ring-slate-200 bg-slate-50" }
}

export function MatchBadge({ score, loading, compact, className }: MatchBadgeProps) {
  if (loading) {
    return compact ? (
      <span className={cn("inline-flex items-center gap-1 rounded-full ring-1 ring-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-400", className)}>
        <Loader2 className="h-3 w-3 animate-spin" />
        Match
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
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full ring-1 px-2 py-0.5 text-[11px] font-semibold",
          colors.ring,
          colors.text,
          className
        )}
      >
        {score}% match
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
