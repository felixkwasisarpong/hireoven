"use client"

import { BarChart2 } from "lucide-react"
import { ScoutCompareRenderer } from "@/components/scout/ScoutCompareRenderer"
import type { ScoutResponse } from "@/lib/scout/types"
import type { ActiveEntities } from "./ScoutWorkspaceShell"

type Props = {
  response: ScoutResponse
  onFollowUp: (query: string) => void
  activeEntities?: ActiveEntities
}

function getReadableAnswer(answer: string): string {
  const trimmed = answer.trim()
  if (/^\s*[{[]/.test(trimmed)) return ""
  return trimmed
}

export function CompareMode({ response, onFollowUp, activeEntities }: Props) {
  const compare = response.compare
  if (!compare) return null

  const answerText = getReadableAnswer(response.answer)

  return (
    <div className="space-y-5">

      {/* Header row */}
      <div className="flex items-center gap-2.5">
        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-slate-950">
          <BarChart2 className="h-3.5 w-3.5 text-white" />
        </div>
        <p className="text-sm font-semibold text-gray-900">
          Comparing {compare.items.length} role{compare.items.length !== 1 ? "s" : ""}
        </p>
      </div>

      {/* Comparison grid — full width (most important content) */}
      <ScoutCompareRenderer compare={compare} />

      {/* Split: tradeoffs left, intelligence right */}
      {(compare.tradeoffs?.length || answerText) && (
        <div className="grid gap-5 lg:grid-cols-[1fr_240px]">

          {/* Tradeoffs */}
          {compare.tradeoffs && compare.tradeoffs.length > 0 && (
            <div>
              <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-400">
                Key tradeoffs
              </p>
              <ul className="space-y-2.5 border-l-2 border-gray-100 pl-4">
                {compare.tradeoffs.map((t, i) => (
                  <li key={i} className="text-sm leading-5 text-gray-700">
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Intelligence pane */}
          <div className="hidden space-y-4 lg:block">
            {answerText && (
              <div>
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-400">
                  Scout summary
                </p>
                <p className="text-xs leading-5 text-gray-600">{answerText}</p>
              </div>
            )}

            {compare.winnerJobId && (
              <div className="border-t border-gray-100 pt-4">
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-400">
                  Recommendation
                </p>
                {(() => {
                  const winner = compare.items.find((i) => i.jobId === compare.winnerJobId)
                  if (!winner) return null
                  return (
                    <div>
                      <p className="text-sm font-semibold text-[#FF5C18]">
                        {winner.title}
                      </p>
                      {winner.company && (
                        <p className="text-xs text-gray-500">{winner.company}</p>
                      )}
                    </div>
                  )
                })()}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Follow-up chips */}
      <div className="flex flex-wrap gap-2">
        {[
          "Which has better salary?",
          "Which sponsors H-1B?",
          "Apply to the best one",
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
