"use client"

import { BarChart2 } from "lucide-react"
import { ScoutCompareRenderer } from "@/components/scout/ScoutCompareRenderer"
import type { ScoutResponse } from "@/lib/scout/types"
import type { ActiveEntities } from "./ScoutWorkspaceShell"
import { getScoutDisplayText as getReadableAnswer } from "@/lib/scout/display-text"

type Props = {
  response: ScoutResponse
  onFollowUp: (query: string) => void
  activeEntities?: ActiveEntities
}

export function CompareMode({ response, onFollowUp }: Props) {
  const compare = response.compare
  if (!compare) return null

  const answerText = getReadableAnswer(response.answer)

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center gap-3 opacity-0 animate-[scout-card-in_0.4s_cubic-bezier(0.22,1,0.36,1)_forwards]">
        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-slate-950 shadow-[0_2px_8px_-2px_rgba(15,23,42,0.4)]">
          <BarChart2 className="h-3.5 w-3.5 text-white" />
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">
            Job comparison
          </p>
          <h2 className="text-sm font-semibold text-slate-900">
            {compare.items.length} role{compare.items.length !== 1 ? "s" : ""} ranked for you
          </h2>
        </div>
      </div>

      {/* Cards */}
      <ScoutCompareRenderer compare={compare} />

      {/* Scout summary — shown below cards if present */}
      {answerText && (
        <p className="text-sm leading-6 text-slate-600 opacity-0 animate-[scout-card-in_0.5s_cubic-bezier(0.22,1,0.36,1)_forwards] [animation-delay:300ms]">
          {answerText}
        </p>
      )}

      {/* Follow-up chips */}
      <div className="flex flex-wrap gap-2 opacity-0 animate-[scout-card-in_0.5s_cubic-bezier(0.22,1,0.36,1)_forwards] [animation-delay:400ms]">
        {[
          "Which has better salary?",
          "Which sponsors H-1B?",
          "Apply to the best one",
        ].map((chip) => (
          <button
            key={chip}
            type="button"
            onClick={() => onFollowUp(chip)}
            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-500 transition hover:border-slate-900 hover:bg-slate-900 hover:text-white"
          >
            {chip}
          </button>
        ))}
      </div>
    </div>
  )
}
