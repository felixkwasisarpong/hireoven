"use client"

import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import SessionTimer from "@/components/interview/SessionTimer"

const PERSONA_LABELS: Record<string, string> = {
  friendly_recruiter: "Friendly Recruiter",
  skeptical_hm:       "Skeptical HM",
  senior_staff:       "Senior Staff",
  founder:            "Founder",
  panel:              "Panel",
}

type Props = {
  persona: string
  jobTitle: string
  jobCompany: string | null
  remainingSec: number
  onEndInterview: () => void
  sessionStatus: string
  practiceFocus?: string | null
}

export default function InterviewTopBar({
  persona,
  jobTitle,
  jobCompany,
  remainingSec,
  onEndInterview,
  sessionStatus,
  practiceFocus,
}: Props) {
  const isEnded = sessionStatus === "completed" || sessionStatus === "abandoned"

  return (
    <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-2.5 sm:px-6">
      <Link
        href="/dashboard/interview"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100"
        aria-label="Back to hub"
      >
        <ArrowLeft className="h-4 w-4" />
      </Link>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-[13px] font-semibold text-slate-800">
            {PERSONA_LABELS[persona] ?? persona} · {jobTitle}
            {jobCompany ? ` @ ${jobCompany}` : ""}
          </p>
          {practiceFocus && (
            <span className="shrink-0 rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-orange-600">
              Practice drill
            </span>
          )}
        </div>
        {practiceFocus ? (
          <p className="truncate text-[11px] text-orange-500">{practiceFocus}</p>
        ) : (
          <p className="text-[11px] text-slate-400">Text interview</p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-3">
        {!isEnded && <SessionTimer remainingSec={remainingSec} />}
        {!isEnded && (
          <button
            type="button"
            onClick={onEndInterview}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-slate-600 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600"
          >
            End interview
          </button>
        )}
      </div>
    </div>
  )
}
