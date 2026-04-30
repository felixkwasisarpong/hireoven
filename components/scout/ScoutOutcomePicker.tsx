"use client"

import { useState } from "react"
import { CheckCircle2, ChevronDown, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { OUTCOME_LABELS, type ApplicationOutcome } from "@/lib/scout/outcomes/types"

const OUTCOME_GROUPS: { label: string; outcomes: ApplicationOutcome[] }[] = [
  {
    label: "Progress",
    outcomes: ["recruiter_screen", "interview", "assessment", "offer"],
  },
  {
    label: "No response",
    outcomes: ["ghosted"],
  },
  {
    label: "Closed",
    outcomes: ["rejected", "withdrawn"],
  },
]

const OUTCOME_TONE: Partial<Record<ApplicationOutcome, string>> = {
  recruiter_screen: "text-emerald-600 bg-emerald-50 hover:bg-emerald-100 border-emerald-200",
  interview:        "text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border-emerald-200",
  assessment:       "text-emerald-600 bg-emerald-50 hover:bg-emerald-100 border-emerald-200",
  offer:            "text-emerald-800 bg-emerald-100 hover:bg-emerald-200 border-emerald-300",
  ghosted:          "text-slate-600 bg-slate-50  hover:bg-slate-100  border-slate-200",
  rejected:         "text-red-600    bg-red-50    hover:bg-red-100    border-red-200",
  withdrawn:        "text-slate-500  bg-slate-50  hover:bg-slate-100  border-slate-200",
}

type Props = {
  applicationId:  string
  currentOutcome?: ApplicationOutcome | null
  compact?:       boolean
  onRecorded?:    (outcome: ApplicationOutcome) => void
}

export function ScoutOutcomePicker({ applicationId, currentOutcome, compact = false, onRecorded }: Props) {
  const [saving,   setSaving]   = useState(false)
  const [recorded, setRecorded] = useState<ApplicationOutcome | null>(currentOutcome ?? null)
  const [open,     setOpen]     = useState(false)

  async function handleSelect(outcome: ApplicationOutcome) {
    setSaving(true)
    setOpen(false)
    try {
      await fetch("/api/scout/outcomes", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ applicationId, outcome }),
      })
      setRecorded(outcome)
      onRecorded?.(outcome)
    } catch {}
    setSaving(false)
  }

  if (compact) {
    return (
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          disabled={saving}
          className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 transition hover:border-slate-950 hover:bg-slate-950 hover:text-white"
        >
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
          {recorded ? OUTCOME_LABELS[recorded] : "Record outcome"}
          <ChevronDown className="h-3 w-3" />
        </button>

        {open && (
          <div className="absolute left-0 top-full z-20 mt-1 w-52 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
            {OUTCOME_GROUPS.map((group) => (
              <div key={group.label}>
                <p className="px-3 pt-2.5 pb-1 text-[9px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                  {group.label}
                </p>
                {group.outcomes.map((outcome) => (
                  <button
                    key={outcome}
                    type="button"
                    onClick={() => handleSelect(outcome)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                  >
                    <span
                      className={cn(
                        "h-1.5 w-1.5 flex-shrink-0 rounded-full",
                        ["recruiter_screen", "interview", "assessment", "offer"].includes(outcome) ? "bg-emerald-400" :
                        outcome === "rejected" ? "bg-red-400" : "bg-slate-300"
                      )}
                    />
                    {OUTCOME_LABELS[outcome]}
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

  // Full mode — show outcome buttons grouped
  return (
    <div className="space-y-3">
      {recorded && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
          <span className="text-xs font-semibold text-emerald-700">
            Recorded: {OUTCOME_LABELS[recorded]}
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
            {group.outcomes.map((outcome) => (
              <button
                key={outcome}
                type="button"
                onClick={() => handleSelect(outcome)}
                disabled={saving}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-[11px] font-semibold transition",
                  OUTCOME_TONE[outcome] ?? "text-slate-600 bg-slate-50 hover:bg-slate-100 border-slate-200",
                  saving && "opacity-50 cursor-not-allowed"
                )}
              >
                {saving ? <Loader2 className="inline h-3 w-3 animate-spin mr-1" /> : null}
                {OUTCOME_LABELS[outcome]}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
