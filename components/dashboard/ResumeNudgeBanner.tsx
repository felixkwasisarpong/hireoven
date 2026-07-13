"use client"

import Link from "next/link"
import { FileUp, Sparkles } from "lucide-react"

/**
 * Compact feed strip for users with no resume: explains the empty
 * "MATCH — no score yet" rings and links to upload. Rendered by the dashboard
 * feed only when the resume context reports no resume; disappears permanently
 * once one is uploaded.
 */
export default function ResumeNudgeBanner() {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-orange-200 bg-gradient-to-r from-orange-50 to-amber-50 px-4 py-2.5">
      <p className="flex min-w-0 items-center gap-2 text-[13px] text-slate-700">
        <Sparkles className="h-4 w-4 shrink-0 text-orange-500" aria-hidden />
        <span className="truncate">
          <span className="font-semibold text-slate-900">See your match score on every job</span>
          <span className="hidden sm:inline"> — upload your resume to light up the match rings.</span>
        </span>
      </p>
      <Link
        href="/dashboard/resume"
        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-orange-500 px-3 py-1.5 text-[12.5px] font-semibold text-white transition hover:bg-orange-600"
      >
        <FileUp className="h-3.5 w-3.5" aria-hidden />
        Upload resume
      </Link>
    </div>
  )
}
