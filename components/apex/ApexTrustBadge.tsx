"use client"

/**
 * ScoutTrustBadge — persistent, subtle safety copy.
 *
 * Reinforces Scout's safety model without being intrusive.
 * Appears below action tiles in idle mode and near sensitive actions.
 *
 * Core message: "Scout prepares. You approve."
 */

import { Shield } from "lucide-react"
import { cn } from "@/lib/utils"

type Variant = "inline" | "strip" | "pill"

type Props = {
  variant?: Variant
  message?: string
  className?: string
}

const DEFAULT_MESSAGE = "Scout prepares. You approve. Nothing is submitted automatically."

const SAFETY_POINTS = [
  "No applications are submitted automatically",
  "Sensitive questions always require your input",
  "You approve every autofill before it runs",
]

export function ScoutTrustBadge({ variant = "inline", message, className }: Props) {
  if (variant === "pill") {
    return (
      <span className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10.5px] font-medium text-slate-500",
        className,
      )}>
        <Shield className="h-3 w-3 text-slate-400" />
        {message ?? "Scout prepares. You approve."}
      </span>
    )
  }

  if (variant === "strip") {
    return (
      <div className={cn(
        "flex flex-wrap items-center justify-center gap-x-6 gap-y-1 py-3 text-[10.5px] text-slate-400",
        className,
      )}>
        {SAFETY_POINTS.map((pt) => (
          <span key={pt} className="flex items-center gap-1.5">
            <Shield className="h-3 w-3 flex-shrink-0 text-slate-300" />
            {pt}
          </span>
        ))}
      </div>
    )
  }

  // inline (default)
  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <Shield className="h-3 w-3 flex-shrink-0 text-slate-400" />
      <p className="text-[10.5px] text-slate-400">
        {message ?? DEFAULT_MESSAGE}
      </p>
    </div>
  )
}
