"use client"

import { Sparkles, X } from "lucide-react"
import { cn } from "@/lib/utils"

type Props = {
  modeLabel: string
  narrative?: string
  onDismiss?: () => void
  className?: string
}

export function ScoutNarrativeHeader({ modeLabel, narrative, onDismiss, className }: Props) {
  if (!narrative && !modeLabel) return null
  return (
    <header
      className={cn(
        "mb-4 flex items-start gap-3 rounded-2xl border border-slate-200/80 bg-white/85 px-4 py-3 backdrop-blur",
        "motion-safe:animate-[scoutFadeUp_0.4s_ease-out_both]",
        className
      )}
    >
      <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#FFEAE0] ring-1 ring-[#FFD5C2]">
        <Sparkles className="h-3.5 w-3.5 text-[#FF5C18]" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-[#FF5C18]">
          {modeLabel}
        </p>
        {narrative && (
          <p className="mt-0.5 text-[13.5px] leading-relaxed text-slate-700">{narrative}</p>
        )}
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="shrink-0 rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </header>
  )
}
