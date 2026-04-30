"use client"

import Link from "next/link"
import { ArrowRight, FileText, Sparkles } from "lucide-react"
import type { ScoutResponse, ScoutAction } from "@/lib/scout/types"

type Props = {
  response: ScoutResponse
  onFollowUp: (query: string) => void
}

function getReadableAnswer(answer: string): string {
  const trimmed = answer.trim()
  if (/^\s*[{[]/.test(trimmed)) return "Scout identified tailoring opportunities for this role."
  return trimmed
}

export function TailorMode({ response, onFollowUp }: Props) {
  const tailorAction = response.actions?.find(
    (a): a is Extract<ScoutAction, { type: "OPEN_RESUME_TAILOR" }> =>
      a.type === "OPEN_RESUME_TAILOR"
  )
  const answerText = getReadableAnswer(response.answer)

  const tailorUrl = tailorAction?.payload?.jobId
    ? `/dashboard/resume/tailor?jobId=${tailorAction.payload.jobId}`
    : tailorAction?.payload?.resumeId
      ? `/dashboard/resume/tailor?resumeId=${tailorAction.payload.resumeId}`
      : "/dashboard/resume/tailor"

  return (
    <div className="space-y-5">
      {/* Scout answer */}
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-xl bg-[#FF5C18] shadow-[0_4px_14px_rgba(255,92,24,0.3)]">
          <Sparkles className="h-3.5 w-3.5 text-white" />
        </span>
        <div className="min-w-0 flex-1 rounded-2xl rounded-tl-sm border border-slate-100 bg-white px-4 py-3 shadow-sm">
          <p className="text-sm leading-6 text-gray-700">{answerText}</p>
        </div>
      </div>

      {/* Tailor CTA card */}
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
        <div className="border-b border-gray-100 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-slate-950">
              <FileText className="h-4 w-4 text-white" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">Resume tailoring</p>
              <p className="text-[11px] text-gray-400">
                Scout will adapt your resume to match the target role
              </p>
            </div>
          </div>
        </div>

        <div className="px-5 py-4">
          {/* What Scout will do */}
          <ul className="mb-5 space-y-2">
            {[
              "Align your bullet points to the job description keywords",
              "Highlight skills and experience that match requirements",
              "Suggest additions for gaps Scout detected",
            ].map((item) => (
              <li key={item} className="flex items-start gap-2 text-sm text-gray-600">
                <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[#FF5C18]" />
                {item}
              </li>
            ))}
          </ul>

          <Link
            href={tailorUrl}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
          >
            Open Resume Studio
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      {/* Quick follow-ups */}
      <div className="flex flex-wrap gap-2">
        {[
          "What gaps does my resume have?",
          "Which sections need the most work?",
          "What keywords should I add?",
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
