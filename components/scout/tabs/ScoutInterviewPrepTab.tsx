"use client"

import { BookOpen, Sparkles } from "lucide-react"
import { ScoutInterviewPrepRenderer } from "@/components/scout/ScoutInterviewPrepRenderer"
import { ScoutMockInterview } from "@/components/scout/ScoutMockInterview"
import type { ScoutInterviewPrep } from "@/lib/scout/types"

export type ScoutInterviewPrepTabProps = {
  interviewPrep: ScoutInterviewPrep | null
  onFillChip: (chip: string) => void
  /** Optional job context for the mock interview */
  jobId?: string
  resumeId?: string
  jobTitle?: string
  companyName?: string
}

export function ScoutInterviewPrepTab({
  interviewPrep,
  onFillChip,
  jobId,
  resumeId,
  jobTitle,
  companyName,
}: ScoutInterviewPrepTabProps) {
  if (!interviewPrep) {
    return (
      <div className="space-y-5">
        {/* Empty state for prep */}
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 px-8 py-12 text-center">
          <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100">
            <BookOpen className="h-5 w-5 text-slate-400" />
          </div>
          <p className="mt-4 text-[15px] font-semibold text-slate-700">No interview prep yet</p>
          <p className="mt-1.5 max-w-xs text-sm leading-6 text-slate-500">
            Open a specific job and ask Scout to prepare you for the interview. Scout tailors prep
            to the role and your resume.
          </p>
          <button
            type="button"
            onClick={() => onFillChip("Prep me for this interview")}
            className="mt-5 inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 shadow-sm transition hover:border-blue-300 hover:text-blue-700"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Prep me for this interview
          </button>
        </div>

        {/* Mock interview — available even without prep content */}
        <ScoutMockInterview
          jobId={jobId}
          resumeId={resumeId}
          jobTitle={jobTitle}
          companyName={companyName}
        />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Prep content */}
      <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_2px_16px_rgba(15,23,42,0.06)]">
        <div className="border-b border-slate-100 px-5 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">
            Most Recent Prep
          </p>
          <h2 className="mt-1 text-base font-bold text-slate-900">Interview Preparation</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Based on the job, your resume, and company context.
          </p>
        </div>
        <div className="p-5">
          <ScoutInterviewPrepRenderer interviewPrep={interviewPrep} />
        </div>
      </section>

      {/* Mock interview — always shown below prep */}
      <ScoutMockInterview
        jobId={jobId}
        resumeId={resumeId}
        jobTitle={jobTitle}
        companyName={companyName}
      />
    </div>
  )
}
