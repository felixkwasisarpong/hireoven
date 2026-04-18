"use client"

import { memo } from "react"
import { Sparkles, Zap } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ScoreMethod } from "@/types"

type Props = {
  score: number | null
  method: ScoreMethod | null
  isLoading: boolean
  size: "sm" | "md"
  onClick?: () => void
  showDisqualifiers?: boolean
  isRemoteOnly?: boolean
  needsSponsorship?: boolean
  isSponsorshipCompatible?: boolean | null
  hasSeniorityMismatch?: boolean
}

function scoreStyles(score: number, method: ScoreMethod | null) {
  if (score >= 85) {
    return method === "deep"
      ? "border-emerald-200 bg-emerald-100 text-emerald-800"
      : "border-emerald-200 bg-emerald-50 text-emerald-700"
  }

  if (score >= 70) {
    return method === "deep"
      ? "border-cyan-200 bg-cyan-100 text-cyan-800"
      : "border-cyan-200 bg-cyan-50 text-cyan-700"
  }

  if (score >= 50) {
    return method === "deep"
      ? "border-amber-200 bg-amber-100 text-amber-800"
      : "border-amber-200 bg-amber-50 text-amber-700"
  }

  return method === "deep"
    ? "border-slate-200 bg-slate-200 text-slate-700"
    : "border-slate-200 bg-slate-100 text-slate-600"
}

function MatchScorePillComponent({
  score,
  method,
  isLoading,
  size,
  onClick,
  showDisqualifiers = false,
  isSponsorshipCompatible,
  hasSeniorityMismatch = false,
}: Props) {
  const controlClass = cn(
    "inline-flex items-center gap-1.5 rounded-full border font-semibold transition",
    size === "sm" ? "px-2.5 py-1 text-[11px]" : "px-3 py-1.5 text-xs",
    onClick && "cursor-pointer hover:opacity-85"
  )

  if (isLoading) {
    return (
      <span className="inline-flex items-center gap-2">
        <span
          className={cn(
            "inline-flex animate-pulse rounded-full border border-slate-200 bg-slate-100",
            size === "sm" ? "h-6 w-24" : "h-8 w-28"
          )}
        />
      </span>
    )
  }

  if (score === null) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(
          controlClass,
          "border-slate-200 bg-slate-100 text-slate-600 hover:bg-slate-200"
        )}
      >
        Upload resume to see match
      </button>
    )
  }

  const Icon = method === "deep" ? Sparkles : Zap
  const label =
    method === "deep"
      ? "AI-analyzed match"
      : "Fast match — click for full analysis"

  const pill = (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={cn(controlClass, scoreStyles(score, method))}
    >
      <Icon className={cn(size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4")} />
      {score}% match
    </button>
  )

  if (!showDisqualifiers) return pill

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {pill}
      {isSponsorshipCompatible === false && (
        <span className="rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-semibold text-red-700">
          No sponsorship
        </span>
      )}
      {hasSeniorityMismatch && (
        <span className="rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
          Seniority mismatch
        </span>
      )}
    </span>
  )
}

export const MatchScorePill = memo(MatchScorePillComponent)
