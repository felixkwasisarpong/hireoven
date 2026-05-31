"use client"

import { Brain, X, Trash2 } from "lucide-react"
import type { ScoutMemoryChip } from "@/lib/scout/search-profile"

type Props = {
  chips: ScoutMemoryChip[]
  onDismiss: (key: ScoutMemoryChip["fieldKey"]) => void
  onClearAll: () => void
}

export function ScoutMemoryChips({ chips, onDismiss, onClearAll }: Props) {
  if (chips.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-2 px-1">
      <div className="flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-[0.2em] text-slate-400">
        <Brain className="h-3 w-3" />
        Scout learned
      </div>

      {chips.map((chip) => (
        <span
          key={chip.key}
          className="group inline-flex items-center gap-1.5 rounded-full border border-blue-200/80 bg-blue-50 px-3 py-1 text-[11px] font-semibold text-blue-700 shadow-[0_1px_2px_rgba(37,99,235,0.10)] transition hover:border-blue-400/70"
        >
          {chip.label}
          <button
            type="button"
            onClick={() => onDismiss(chip.fieldKey)}
            aria-label={`Remove: ${chip.label}`}
            className="text-blue-500/60 transition hover:text-blue-700"
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </span>
      ))}

      <button
        type="button"
        onClick={onClearAll}
        className="inline-flex items-center gap-1 text-[10.5px] font-medium text-slate-400 transition hover:text-slate-600"
        title="Clear all Scout memory"
      >
        <Trash2 className="h-2.5 w-2.5" />
        Clear
      </button>
    </div>
  )
}
