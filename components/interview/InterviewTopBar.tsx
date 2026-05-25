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
    <div className="relative flex items-center gap-3 border-b border-[#eed9cd] bg-[#fffaf6] px-4 py-2.5 sm:px-6">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_85%_0%,rgba(255,180,130,0.16),transparent_50%)]" />
      <Link
        href="/dashboard/interview"
        className="relative z-[1] flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#f1ddd4] bg-white text-slate-500 shadow-sm transition hover:border-[#f0c4b0] hover:text-slate-700"
        aria-label="Back to hub"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
      </Link>

      <div className="relative z-[1] min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-[13px] font-semibold text-slate-800">
            {PERSONA_LABELS[persona] ?? persona}
            <span className="mx-1.5 text-slate-300">·</span>
            {jobTitle}{jobCompany ? ` @ ${jobCompany}` : ""}
          </p>
          {practiceFocus && (
            <span className="shrink-0 rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-orange-600">
              Drill
            </span>
          )}
        </div>
        {practiceFocus ? (
          <p className="truncate text-[11px] text-orange-500/80">{practiceFocus}</p>
        ) : (
          <p className="text-[11px] text-slate-400">Text interview</p>
        )}
      </div>

      <div className="relative z-[1] flex shrink-0 items-center gap-2">
        {!isEnded && (
          <div className="rounded-lg border border-[#f1dfd4] bg-white/80 px-2.5 py-1 shadow-sm">
            <SessionTimer remainingSec={remainingSec} />
          </div>
        )}
        {!isEnded && (
          <button
            type="button"
            onClick={onEndInterview}
            className="rounded-lg border border-[#f0d5c5] bg-white px-3 py-1.5 text-[12px] font-semibold text-slate-600 shadow-sm transition hover:border-red-200 hover:bg-red-50 hover:text-red-600"
          >
            End
          </button>
        )}
      </div>
    </div>
  )
}
