"use client"

/**
 * ScoutOutcomePicker — V2
 *
 * Records typed outcome lifecycle events against an application.
 * Calls the new /api/scout/outcomes/record endpoint which writes
 * to scout_outcomes and optionally advances the application status.
 *
 * Also exports ScoutSignalReactionBar — lightweight reaction buttons
 * for learning signal cards (helpful / got interview / not helpful).
 */

import { useState } from "react"
import { CheckCircle2, ChevronDown, Loader2, ThumbsUp, ThumbsDown, Briefcase, X } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ScoutOutcomeType, ScoutSignalReaction } from "@/lib/scout/outcomes/types"
import { SCOUT_OUTCOME_LABELS, SIGNAL_REACTION_LABELS } from "@/lib/scout/outcomes/types"

// ── Outcome groups for the picker UI ─────────────────────────────────────────

const OUTCOME_GROUPS: { label: string; outcomes: ScoutOutcomeType[] }[] = [
  {
    label: "Progress",
    outcomes: [
      "application_reviewed",
      "recruiter_reply",
      "interview_received",
      "interview_passed",
      "offer_received",
      "offer_accepted",
    ],
  },
  {
    label: "Closed",
    outcomes: ["application_rejected"],
  },
]

const OUTCOME_TONE: Partial<Record<ScoutOutcomeType, string>> = {
  application_reviewed: "text-sky-600 bg-sky-50 hover:bg-sky-100 border-sky-200",
  recruiter_reply:      "text-emerald-600 bg-emerald-50 hover:bg-emerald-100 border-emerald-200",
  interview_received:   "text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border-emerald-200",
  interview_passed:     "text-emerald-800 bg-emerald-100 hover:bg-emerald-200 border-emerald-300",
  offer_received:       "text-amber-700 bg-amber-50 hover:bg-amber-100 border-amber-200",
  offer_accepted:       "text-amber-800 bg-amber-100 hover:bg-amber-200 border-amber-300",
  application_rejected: "text-red-600 bg-red-50 hover:bg-red-100 border-red-200",
}

const OUTCOME_DOT: Partial<Record<ScoutOutcomeType, string>> = {
  application_reviewed: "bg-sky-400",
  recruiter_reply:      "bg-emerald-400",
  interview_received:   "bg-emerald-500",
  interview_passed:     "bg-emerald-600",
  offer_received:       "bg-amber-400",
  offer_accepted:       "bg-amber-500",
  application_rejected: "bg-red-400",
}

// ── ScoutOutcomePicker ────────────────────────────────────────────────────────

type PickerProps = {
  applicationId:   string
  currentOutcome?: ScoutOutcomeType | null
  compact?:        boolean
  onRecorded?:     (outcome: ScoutOutcomeType) => void
}

export function ScoutOutcomePicker({
  applicationId,
  currentOutcome,
  compact = false,
  onRecorded,
}: PickerProps) {
  const [saving,   setSaving]   = useState(false)
  const [recorded, setRecorded] = useState<ScoutOutcomeType | null>(currentOutcome ?? null)
  const [open,     setOpen]     = useState(false)

  async function handleSelect(type: ScoutOutcomeType) {
    setSaving(true)
    setOpen(false)
    try {
      await fetch("/api/scout/outcomes/record", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ type, applicationId, source: "manual" }),
      })
      setRecorded(type)
      onRecorded?.(type)
    } catch {
      // silently fail — outcome recording is best-effort
    } finally {
      setSaving(false)
    }
  }

  const displayLabel = recorded ? SCOUT_OUTCOME_LABELS[recorded] : "Record outcome"

  // ── Compact mode: dropdown trigger ─────────────────────────────────────
  if (compact) {
    return (
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          disabled={saving}
          className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 transition hover:border-slate-950 hover:bg-slate-950 hover:text-white"
        >
          {saving
            ? <Loader2 className="h-3 w-3 animate-spin" />
            : <CheckCircle2 className="h-3 w-3" />}
          {displayLabel}
          <ChevronDown className="h-3 w-3" />
        </button>

        {open && (
          <div className="absolute left-0 top-full z-20 mt-1 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
            {OUTCOME_GROUPS.map((group) => (
              <div key={group.label}>
                <p className="px-3 pt-2.5 pb-1 text-[9px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                  {group.label}
                </p>
                {group.outcomes.map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => handleSelect(type)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                  >
                    <span
                      className={cn(
                        "h-1.5 w-1.5 flex-shrink-0 rounded-full",
                        OUTCOME_DOT[type] ?? "bg-slate-300",
                      )}
                    />
                    {SCOUT_OUTCOME_LABELS[type]}
                  </button>
                ))}
              </div>
            ))}
            <div className="border-t border-slate-100 px-3 py-2.5">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-[10px] text-slate-400 hover:text-slate-600"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── Full mode: grouped buttons ──────────────────────────────────────────
  return (
    <div className="space-y-3">
      {recorded && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
          <span className="text-xs font-semibold text-emerald-700">
            Recorded: {SCOUT_OUTCOME_LABELS[recorded]}
          </span>
          <button
            type="button"
            onClick={() => setRecorded(null)}
            className="ml-auto text-[10px] text-emerald-500 hover:text-emerald-700"
          >
            Change
          </button>
        </div>
      )}

      {!recorded && OUTCOME_GROUPS.map((group) => (
        <div key={group.label}>
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
            {group.label}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {group.outcomes.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => handleSelect(type)}
                disabled={saving}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-[11px] font-semibold transition",
                  OUTCOME_TONE[type] ?? "text-slate-600 bg-slate-50 hover:bg-slate-100 border-slate-200",
                  saving && "cursor-not-allowed opacity-50",
                )}
              >
                {saving && <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />}
                {SCOUT_OUTCOME_LABELS[type]}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── ScoutSignalReactionBar ────────────────────────────────────────────────────
// Lightweight reaction strip shown below a learning signal card.

type ReactionBarProps = {
  signalId:   string
  onReact?:   (reaction: ScoutSignalReaction) => void
}

const REACTION_BUTTONS: Array<{
  reaction: ScoutSignalReaction
  icon:     React.ReactNode
  label:    string
  style:    string
}> = [
  {
    reaction: "helpful",
    icon:     <ThumbsUp className="h-3 w-3" />,
    label:    "Helpful",
    style:    "text-emerald-600 hover:bg-emerald-50 hover:border-emerald-200",
  },
  {
    reaction: "got_interview",
    icon:     <Briefcase className="h-3 w-3" />,
    label:    "Got interview",
    style:    "text-sky-600 hover:bg-sky-50 hover:border-sky-200",
  },
  {
    reaction: "not_helpful",
    icon:     <ThumbsDown className="h-3 w-3" />,
    label:    "Not helpful",
    style:    "text-slate-500 hover:bg-slate-50 hover:border-slate-200",
  },
  {
    reaction: "ignore",
    icon:     <X className="h-3 w-3" />,
    label:    "Dismiss",
    style:    "text-slate-400 hover:bg-slate-50 hover:border-slate-200",
  },
]

export function ScoutSignalReactionBar({ signalId, onReact }: ReactionBarProps) {
  const [recorded, setRecorded] = useState<ScoutSignalReaction | null>(null)
  const [saving,   setSaving]   = useState(false)

  async function handleReact(reaction: ScoutSignalReaction) {
    if (saving) return
    setSaving(true)
    try {
      await fetch("/api/scout/outcomes/reaction", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ signalId, reaction }),
      })
      setRecorded(reaction)
      onReact?.(reaction)
    } catch {
      // best-effort
    } finally {
      setSaving(false)
    }
  }

  if (recorded) {
    return (
      <p className="text-[10px] text-slate-400 italic">
        Feedback recorded: {SIGNAL_REACTION_LABELS[recorded]}
      </p>
    )
  }

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-300 mr-0.5">
        Was this useful?
      </span>
      {REACTION_BUTTONS.map(({ reaction, icon, label, style }) => (
        <button
          key={reaction}
          type="button"
          onClick={() => handleReact(reaction)}
          disabled={saving}
          title={label}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border border-transparent px-2 py-0.5 text-[10px] font-medium transition",
            style,
            saving && "cursor-not-allowed opacity-50",
          )}
        >
          {icon}
          <span className="hidden sm:inline">{label}</span>
        </button>
      ))}
    </div>
  )
}
