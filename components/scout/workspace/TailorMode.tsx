"use client"

import Link from "next/link"
import { ArrowRight, FileText } from "lucide-react"
import type { ScoutResponse, ScoutAction } from "@/lib/scout/types"
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

const TAILOR_STEPS = [
  "Align bullet points to job description keywords",
  "Highlight skills and experience that match requirements",
  "Suggest additions for gaps Scout detected",
]

export function TailorMode({ response, onFollowUp, activeEntities }: Props) {
  const tailorAction = response.actions?.find(
    (a): a is Extract<ScoutAction, { type: "OPEN_RESUME_TAILOR" }> =>
      a.type === "OPEN_RESUME_TAILOR"
  )
  const tailorUrl = tailorAction?.payload?.jobId
    ? `/dashboard/resume/tailor?jobId=${tailorAction.payload.jobId}`
    : tailorAction?.payload?.resumeId
      ? `/dashboard/resume/tailor?resumeId=${tailorAction.payload.resumeId}`
      : "/dashboard/resume/tailor"

  const answerText = getReadableAnswer(response.answer)
  const hasEntity  = activeEntities?.jobTitle || activeEntities?.companyName

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_240px]">

      {/* ── Left: tailoring action ────────────────────────────────────── */}
      <div className="space-y-4">
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">

          <div className="flex items-center gap-3 border-b border-gray-100 px-5 py-4">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-slate-950">
              <FileText className="h-4 w-4 text-white" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">Resume tailoring</p>
              {hasEntity && (
                <p className="text-[11px] text-gray-400">
                  {activeEntities?.jobTitle ?? ""}{activeEntities?.jobTitle && activeEntities?.companyName ? " at " : ""}{activeEntities?.companyName ?? ""}
                </p>
              )}
            </div>
          </div>

          <div className="px-5 py-4">
            <ul className="mb-5 space-y-2.5 border-l-2 border-gray-100 pl-4">
              {TAILOR_STEPS.map((step) => (
                <li key={step} className="text-sm text-gray-600">{step}</li>
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

        {/* Follow-up chips */}
        <div className="flex flex-wrap gap-2">
          {["What gaps should I fix?", "Which sections are weakest?", "Show me keywords"].map((chip) => (
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
              Scout insight
            </p>
            <p className="text-xs leading-5 text-gray-600">{answerText}</p>
          </div>
        )}

        {hasEntity && (
          <div className={answerText ? "border-t border-gray-100 pt-4" : ""}>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-400">
              Target role
            </p>
            {activeEntities?.jobTitle && (
              <p className="text-sm font-semibold text-gray-800">{activeEntities.jobTitle}</p>
            )}
            {activeEntities?.companyName && (
              <p className="mt-0.5 text-xs text-gray-500">{activeEntities.companyName}</p>
            )}
          </div>
        )}

        <div className={hasEntity || answerText ? "border-t border-gray-100 pt-4" : ""}>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-400">
            Process
          </p>
          <ol className="space-y-1.5">
            {["Review Scout's suggested edits", "Approve or adjust changes", "Save as new resume version"].map((s, i) => (
              <li key={s} className="flex items-start gap-2 text-xs text-gray-500">
                <span className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-gray-100 text-[9px] font-bold text-gray-500">
                  {i + 1}
                </span>
                {s}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  )
}
