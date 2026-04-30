"use client"

import { useState } from "react"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"
import { ScoutOutcomePicker } from "./ScoutOutcomePicker"
import { dismissFeedbackPrompt, isFeedbackDismissed } from "@/lib/scout/outcomes/store"
import type { ApplicationFeedbackItem, ApplicationOutcome } from "@/lib/scout/outcomes/types"

type SinglePromptProps = {
  item:        ApplicationFeedbackItem
  onDismiss:   (id: string) => void
  onRecorded:  (id: string, outcome: ApplicationOutcome) => void
}

function SingleFeedbackPrompt({ item, onDismiss, onRecorded }: SinglePromptProps) {
  const [expanded, setExpanded] = useState(false)

  const daysText =
    item.daysSinceApplied >= 30 ? `${Math.floor(item.daysSinceApplied / 7)} weeks` :
    `${item.daysSinceApplied} day${item.daysSinceApplied !== 1 ? "s" : ""}`

  return (
    <div className="overflow-hidden rounded-xl border border-slate-100 bg-white shadow-[0_1px_4px_rgba(15,23,42,0.06)]">
      <div className="flex items-start justify-between gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] text-slate-400">Applied {daysText} ago</p>
          <p className="mt-0.5 truncate text-sm font-semibold text-slate-800">
            {item.jobTitle}
          </p>
          <p className="text-xs text-slate-500">{item.companyName}</p>
        </div>
        <button
          type="button"
          onClick={() => onDismiss(item.applicationId)}
          className="flex-shrink-0 rounded p-1 text-slate-300 transition hover:text-slate-500"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {!expanded ? (
        <div className="flex items-center gap-2 border-t border-slate-50 px-4 py-2.5">
          <p className="flex-1 text-xs text-slate-500">Did you hear back?</p>
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-700 transition hover:border-slate-950 hover:bg-slate-950 hover:text-white"
          >
            Update status
          </button>
        </div>
      ) : (
        <div className="border-t border-slate-50 px-4 py-3">
          <ScoutOutcomePicker
            applicationId={item.applicationId}
            compact={false}
            onRecorded={(outcome) => onRecorded(item.applicationId, outcome)}
          />
        </div>
      )}
    </div>
  )
}

// ── Strip component ───────────────────────────────────────────────────────────

type Props = {
  items:              ApplicationFeedbackItem[]
  outcomeLearningDisabled?: boolean
  onOutcomeRecorded?: (applicationId: string, outcome: ApplicationOutcome) => void
}

export function ScoutFeedbackPrompt({ items, outcomeLearningDisabled, onOutcomeRecorded }: Props) {
  const [dismissed, setDismissed]   = useState<Set<string>>(new Set())
  const [recorded,  setRecorded]    = useState<Set<string>>(new Set())

  if (outcomeLearningDisabled) return null

  const visible = items.filter(
    (item) => !dismissed.has(item.applicationId) && !recorded.has(item.applicationId) && !isFeedbackDismissed(item.applicationId)
  )

  if (visible.length === 0) return null

  function handleDismiss(id: string) {
    dismissFeedbackPrompt(id)
    setDismissed((prev) => new Set(prev).add(id))
  }

  function handleRecorded(id: string, outcome: ApplicationOutcome) {
    setRecorded((prev) => new Set(prev).add(id))
    onOutcomeRecorded?.(id, outcome)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">
          Outcome updates
        </p>
        <p className="text-[10px] text-slate-300">Helps Scout learn what's working</p>
      </div>

      {/* Show at most 2 prompts at once — not nagging */}
      {visible.slice(0, 2).map((item) => (
        <SingleFeedbackPrompt
          key={item.applicationId}
          item={item}
          onDismiss={handleDismiss}
          onRecorded={handleRecorded}
        />
      ))}
    </div>
  )
}
