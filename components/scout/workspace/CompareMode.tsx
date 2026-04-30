"use client"

import { BarChart2, Sparkles } from "lucide-react"
import { ScoutCompareRenderer } from "@/components/scout/ScoutCompareRenderer"
import type { ScoutResponse } from "@/lib/scout/types"

type Props = {
  response: ScoutResponse
  onFollowUp: (query: string) => void
}

function getReadableAnswer(answer: string): string {
  const trimmed = answer.trim()
  if (/^\s*[{[]/.test(trimmed)) return "Scout prepared a comparison based on your saved jobs."
  return trimmed
}

export function CompareMode({ response, onFollowUp }: Props) {
  const compare = response.compare
  const answerText = getReadableAnswer(response.answer)

  if (!compare) return null

  return (
    <div className="space-y-5">
      {/* Scout answer strip */}
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-xl bg-[#FF5C18] shadow-[0_4px_14px_rgba(255,92,24,0.3)]">
          <Sparkles className="h-3.5 w-3.5 text-white" />
        </span>
        <div className="min-w-0 flex-1 rounded-2xl rounded-tl-sm border border-slate-100 bg-white px-4 py-3 shadow-sm">
          <p className="text-sm leading-6 text-gray-700">{answerText}</p>
        </div>
      </div>

      {/* Compare header */}
      <div className="flex items-center gap-2.5">
        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-slate-950">
          <BarChart2 className="h-3.5 w-3.5 text-white" />
        </div>
        <p className="text-sm font-semibold text-gray-900">Job comparison</p>
        <span className="ml-auto text-[11px] text-gray-400">
          {compare.items.length} role{compare.items.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Comparison grid — reuses existing renderer */}
      <ScoutCompareRenderer compare={compare} />

      {/* Tradeoffs */}
      {compare.tradeoffs && compare.tradeoffs.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white px-5 py-4">
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-400">
            Key tradeoffs
          </p>
          <ul className="space-y-2">
            {compare.tradeoffs.map((t, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[#FF5C18]" />
                {t}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Quick follow-ups */}
      <div className="flex flex-wrap gap-2">
        {[
          "Which has better sponsorship?",
          "Which pays more?",
          "Which should I apply to first?",
        ].map((chip) => (
          <button
            key={chip}
            type="button"
            onClick={() => onFollowUp(chip)}
            className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-500 transition hover:border-slate-950 hover:bg-slate-950 hover:text-white"
          >
            {chip}
          </button>
        ))}
      </div>
    </div>
  )
}
