"use client"

import { CheckCircle2, Sparkles, Zap } from "lucide-react"
import { ScoutWorkflowRenderer } from "@/components/scout/ScoutWorkflowRenderer"
import { ScoutActionRenderer } from "@/components/scout/ScoutActionRenderer"
import { ScoutInterviewPrepRenderer } from "@/components/scout/ScoutInterviewPrepRenderer"
import type { ScoutResponse } from "@/lib/scout/types"

type Props = {
  response: ScoutResponse
  onFollowUp: (query: string) => void
}

function getReadableAnswer(answer: string): string {
  const trimmed = answer.trim()
  if (/^\s*[{[]/.test(trimmed)) return "Scout prepared a structured plan for your applications."
  return trimmed
}

export function ApplicationMode({ response, onFollowUp }: Props) {
  const answerText = getReadableAnswer(response.answer)
  const hasWorkflow = Boolean(response.workflow)
  const hasInterviewPrep = Boolean(response.interviewPrep)
  const hasActions = (response.actions?.length ?? 0) > 0

  const isInterviewFocused = hasInterviewPrep || response.intent === "interview_prep"

  const followUpChips = isInterviewFocused
    ? ["Give me a practice question", "What should I research?", "How should I answer compensation?"]
    : ["What's my next action?", "Which application needs attention?", "Draft a follow-up email"]

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

      {/* Mode label */}
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-slate-950">
          {isInterviewFocused ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-white" />
          ) : (
            <Zap className="h-3.5 w-3.5 text-white" />
          )}
        </div>
        <p className="text-sm font-semibold text-gray-900">
          {isInterviewFocused ? "Interview preparation" : "Application workflow"}
        </p>
      </div>

      {/* Workflow steps — uses existing renderer */}
      {hasWorkflow && response.workflow && (
        <ScoutWorkflowRenderer workflow={response.workflow} />
      )}

      {/* Interview prep — uses existing renderer */}
      {hasInterviewPrep && response.interviewPrep && (
        <ScoutInterviewPrepRenderer interviewPrep={response.interviewPrep} />
      )}

      {/* Actions — uses existing renderer */}
      {hasActions && !hasWorkflow && (
        <ScoutActionRenderer actions={response.actions} source="chat" />
      )}

      {/* Quick follow-ups */}
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
  )
}
