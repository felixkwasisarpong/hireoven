"use client"

import { CheckCircle2, Zap } from "lucide-react"
import { ScoutWorkflowRenderer } from "@/components/scout/ScoutWorkflowRenderer"
import { ScoutActionRenderer } from "@/components/scout/ScoutActionRenderer"
import { ScoutInterviewPrepRenderer } from "@/components/scout/ScoutInterviewPrepRenderer"
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

export function ApplicationMode({ response, onFollowUp, activeEntities }: Props) {
  const answerText    = getReadableAnswer(response.answer)
  const hasWorkflow   = Boolean(response.workflow)
  const hasInterviewPrep = Boolean(response.interviewPrep)
  const hasActions    = (response.actions?.length ?? 0) > 0
  const isInterviewFocused = hasInterviewPrep || response.intent === "interview_prep"

  const followUpChips = isInterviewFocused
    ? ["Give me a practice question", "What should I research?", "How should I answer compensation?"]
    : ["What's my next action?", "Which application needs attention?", "Draft a follow-up email"]

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_240px]">

      {/* ── Left: main workflow ───────────────────────────────────────── */}
      <div className="space-y-5">
        {/* Mode header */}
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-slate-950">
            {isInterviewFocused
              ? <CheckCircle2 className="h-3.5 w-3.5 text-white" />
              : <Zap className="h-3.5 w-3.5 text-white" />}
          </div>
          <p className="text-sm font-semibold text-gray-900">
            {isInterviewFocused ? "Interview preparation" : "Application workflow"}
          </p>
        </div>

        {hasWorkflow && response.workflow && (
          <ScoutWorkflowRenderer workflow={response.workflow} />
        )}

        {hasInterviewPrep && response.interviewPrep && (
          <ScoutInterviewPrepRenderer interviewPrep={response.interviewPrep} />
        )}

        {hasActions && !hasWorkflow && (
          <ScoutActionRenderer actions={response.actions} source="chat" />
        )}

        <div className="flex flex-wrap gap-2">
          {followUpChips.map((chip) => (
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

      {/* ── Right: intelligence pane ───────────────────────────────────── */}
      <div className="hidden space-y-4 lg:block">
        {answerText && (
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-400">
              Scout context
            </p>
            <p className="text-xs leading-5 text-gray-600">{answerText}</p>
          </div>
        )}

        {(activeEntities?.jobTitle || activeEntities?.companyName) && (
          <div className={answerText ? "border-t border-gray-100 pt-4" : ""}>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-400">
              Active role
            </p>
            {activeEntities?.jobTitle && (
              <p className="text-sm font-semibold text-gray-800">{activeEntities.jobTitle}</p>
            )}
            {activeEntities?.companyName && (
              <p className="mt-0.5 text-xs text-gray-500">{activeEntities.companyName}</p>
            )}
          </div>
        )}

        {isInterviewFocused && (
          <div className="border-t border-gray-100 pt-4">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-400">
              Prep checklist
            </p>
            <ul className="space-y-1.5 text-xs text-gray-500">
              {["Review the job requirements", "Practice 3–5 questions", "Prepare your story", "Research the company"].map((item) => (
                <li key={item} className="flex items-center gap-2">
                  <span className="h-1 w-1 flex-shrink-0 rounded-full bg-gray-300" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
