"use client"

import { useRouter } from "next/navigation"
import { X, Zap, Star } from "lucide-react"
import { cn } from "@/lib/utils"
import { useApexAlerts, type ApexAlert } from "@/hooks/useApexAlerts"

type Props = {
  disabled?: boolean
  className?: string
}

/**
 * Floating real-time alert pill — appears when Apex finds a high-match job.
 * Sits at the top of the workspace and dismisses on click or X.
 */
export function ApexAlertBadge({ disabled, className }: Props) {
  const router = useRouter()
  const { latest, connected, dismiss } = useApexAlerts({ disabled })

  if (!latest) return null

  const isTop = latest.type === "top_drop"

  function open() {
    dismiss()
    router.push(`/dashboard/jobs/${latest!.jobId}`)
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-center gap-2 rounded-full px-3.5 py-2 text-[12.5px] font-semibold shadow-lg",
        "motion-safe:animate-[apexFadeUp_0.4s_ease-out_both]",
        isTop
          ? "border border-amber-300 bg-amber-50 text-amber-900 shadow-amber-100"
          : "border border-slate-200 bg-slate-50 text-slate-800 shadow-indigo-100",
        className,
      )}
    >
      {isTop
        ? <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
        : <Zap className="h-3.5 w-3.5 text-slate-500" />
      }
      <button type="button" onClick={open} className="hover:underline focus-visible:outline-none">
        {isTop ? "Top match dropped" : "New match"} · {latest.matchScore}%{" "}
        <span className="font-medium opacity-80">
          {latest.title}{latest.company ? ` at ${latest.company}` : ""}
        </span>
      </button>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss alert"
        className="ml-1 rounded-full p-0.5 opacity-60 transition hover:opacity-100"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  )
}
