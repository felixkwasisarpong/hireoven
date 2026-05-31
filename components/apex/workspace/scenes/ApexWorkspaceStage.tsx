"use client"

import { ReactNode } from "react"
import { cn } from "@/lib/utils"
import { ScoutNarrativeHeader } from "./ScoutNarrativeHeader"

type Props = {
  modeLabel: string
  narrative?: string
  onDismissNarrative?: () => void
  showNarrative?: boolean
  children: ReactNode
  className?: string
}

/**
 * Focused stage container around an active workspace mode.
 * Replaces the previous "card soup" of stacked panels with one calm surface
 * and an optional small narrative header above the mounted mode component.
 */
export function ScoutWorkspaceStage({
  modeLabel,
  narrative,
  onDismissNarrative,
  showNarrative = true,
  children,
  className,
}: Props) {
  return (
    <section
      aria-label={`${modeLabel} workspace`}
      className={cn(
        "min-w-0 flex-1 motion-safe:animate-[scoutFadeUp_0.45s_ease-out_both]",
        className
      )}
    >
      {showNarrative && narrative && (
        <ScoutNarrativeHeader
          modeLabel={modeLabel}
          narrative={narrative}
          onDismiss={onDismissNarrative}
        />
      )}
      <div className="rounded-3xl border border-slate-200/70 bg-white/70 p-4 shadow-[0_1px_0_rgba(15,23,42,0.04)] backdrop-blur sm:p-5">
        {children}
      </div>
    </section>
  )
}
