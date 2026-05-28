"use client"

import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import CodingTimer from "@/components/interview/CodingTimer"

const PERSONA_LABELS: Record<string, string> = {
  friendly_recruiter: "Recruiter",
  skeptical_hm: "Skeptical HM",
  senior_staff: "Senior Peer",
  founder: "Founder",
  panel: "Panel",
}

type Props = {
  persona: string
  jobTitle: string
  jobCompany: string | null
  remainingSec: number
  targetSec: number
  hintsUsed: number
  hintsTotal: number
  onEnd: () => void
  sessionCompleted: boolean
}

export default function CodingTopBar({
  persona,
  jobTitle,
  jobCompany,
  remainingSec,
  targetSec,
  hintsUsed,
  hintsTotal,
  onEnd,
  sessionCompleted,
}: Props) {
  return (
    <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-2.5 sm:px-6">
      <Link
        href="/dashboard/interview"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100"
      >
        <ArrowLeft className="h-4 w-4" />
      </Link>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold text-slate-800">
          {PERSONA_LABELS[persona] ?? persona} · {jobTitle}
          {jobCompany ? ` @ ${jobCompany}` : ""}
        </p>
        <p className="text-[11px] text-slate-400">Coding interview</p>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        {!sessionCompleted && (
          <>
            <span className="text-[11px] text-slate-400">
              Hints {hintsUsed}/{hintsTotal}
            </span>
            <CodingTimer remainingSec={remainingSec} targetSec={targetSec} />
            <button
              type="button"
              onClick={onEnd}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-slate-600 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600"
            >
              End
            </button>
          </>
        )}
        {sessionCompleted && (
          <span className="text-[12px] font-semibold text-emerald-600">Submitted</span>
        )}
      </div>
    </div>
  )
}
