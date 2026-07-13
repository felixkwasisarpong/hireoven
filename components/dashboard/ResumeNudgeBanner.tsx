"use client"

import Link from "next/link"
import { FileUp, Sparkles } from "lucide-react"

/**
 * Feed banner for users with no resume: every job card shows an empty
 * "MATCH — no score yet" ring with nothing telling them why. Rendered by the
 * dashboard feed when the resume context reports no resume; disappears
 * permanently the moment one is uploaded.
 */
export default function ResumeNudgeBanner() {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-orange-200 bg-gradient-to-r from-orange-50 to-amber-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-orange-500/10">
          <Sparkles className="h-4.5 w-4.5 h-[18px] w-[18px] text-orange-600" aria-hidden />
        </div>
        <div>
          <p className="text-[14px] font-bold text-slate-900">
            See your match score on every job
          </p>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-slate-600">
            Those empty match rings light up once we know you — upload your resume and every job
            gets a personalized 0–100 fit score, instantly.
          </p>
        </div>
      </div>
      <Link
        href="/dashboard/resume"
        className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-orange-500 px-4 py-2.5 text-[13px] font-semibold text-white shadow-sm transition hover:bg-orange-600"
      >
        <FileUp className="h-4 w-4" aria-hidden />
        Upload resume
      </Link>
    </div>
  )
}
