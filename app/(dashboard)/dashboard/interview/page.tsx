"use client"

export const dynamic = "force-dynamic"

import InterviewHubCards from "@/components/interview/InterviewHubCards"
import RecommendedJobsList from "@/components/interview/RecommendedJobsList"
import RecentSessionsList from "@/components/interview/RecentSessionsList"

export default function InterviewHubPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">

      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div className="mb-8">
        <div className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-orange-200 bg-orange-50 px-2.5 py-0.5">
          <span className="h-1.5 w-1.5 rounded-full bg-orange-500" />
          <span className="text-[11px] font-semibold tracking-wide text-orange-600">AI-powered practice</span>
        </div>
        <h1 className="text-[26px] font-bold tracking-tight text-slate-900">
          Interview Practice
        </h1>
        <p className="mt-1.5 max-w-xl text-[14px] leading-relaxed text-slate-500">
          Three modes, one debrief. Pick the format that matches your next real interview.
        </p>
      </div>

      {/* Mode cards */}
      <InterviewHubCards />

      {/* Divider */}
      <div className="mt-10 border-t border-slate-100" />

      {/* Recommended + recent */}
      <RecommendedJobsList />
      <RecentSessionsList />
    </div>
  )
}
