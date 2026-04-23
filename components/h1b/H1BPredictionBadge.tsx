"use client"

import { memo } from "react"
import { cn } from "@/lib/utils"
import type { H1BPrediction, H1BVerdict } from "@/types"

type Size = "sm" | "md"

type Props = {
  prediction: H1BPrediction | null
  isLoading: boolean
  size?: Size
  companyName?: string
  onClick?: () => void
}

const VERDICT_STYLE: Record<H1BVerdict, string> = {
  strong: "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100",
  good: "border-cyan-200 bg-cyan-50 text-cyan-800 hover:bg-cyan-100",
  moderate: "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100",
  risky: "border-red-200 bg-red-50 text-red-800 hover:bg-red-100",
  unknown: "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100",
}

const VERDICT_LABEL: Record<H1BVerdict, string> = {
  strong: "Strong",
  good: "Good",
  moderate: "Moderate",
  risky: "Risky",
  unknown: "Unknown",
}

function SkeletonPill({ size }: { size: Size }) {
  return (
    <span
      className={cn(
        "inline-flex animate-pulse rounded border border-slate-200 bg-slate-100",
        size === "sm" ? "h-5 w-20" : "h-6 w-28"
      )}
    />
  )
}

function H1BPredictionBadgeImpl({
  prediction,
  isLoading,
  size = "sm",
  companyName,
  onClick,
}: Props) {
  if (isLoading) return <SkeletonPill size={size} />
  if (!prediction) return null
  if (!prediction.isUSJob) return null

  const verdict = prediction.verdict
  const className = VERDICT_STYLE[verdict]

  const tooltip =
    verdict === "unknown"
      ? `H1B approval data is limited for this employer. Estimate only, not legal advice.`
      : `~${prediction.approvalLikelihood}% H1B approval likelihood (${prediction.confidenceLevel} confidence). Estimate only - not legal advice.`

  if (size === "sm") {
    const label =
      verdict === "unknown"
        ? "H1B: unknown"
        : `↗ +${prediction.approvalLikelihood}% approval`
    return (
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation()
          onClick?.()
        }}
        title={tooltip}
        className={cn(
          "inline-flex items-center rounded border px-2 py-0.5 text-[11px] font-semibold transition-colors",
          className
        )}
      >
        <span className="mr-1 opacity-60">H1B</span>
        {label}
      </button>
    )
  }

  const signal = prediction.signals[0]
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation()
        onClick?.()
      }}
      title={tooltip}
      className={cn(
        "group flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
        className
      )}
    >
      <div className="flex flex-col">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] opacity-80">
          H1B approval
        </span>
        <span className="mt-0.5 text-sm font-semibold">
          {VERDICT_LABEL[verdict]}
          {verdict !== "unknown" && (
            <span className="ml-1 font-normal opacity-90">
              ~{prediction.approvalLikelihood}%
            </span>
          )}
        </span>
        {signal && (
          <span className="mt-1 text-xs opacity-80 line-clamp-2">
            {companyName ? `${companyName} - ` : ""}
            {signal.detail}
          </span>
        )}
      </div>
    </button>
  )
}

const H1BPredictionBadge = memo(H1BPredictionBadgeImpl)
export default H1BPredictionBadge
