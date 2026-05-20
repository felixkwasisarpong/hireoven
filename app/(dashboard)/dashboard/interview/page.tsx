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
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          Interview Practice
        </h1>
        <p className="mt-1.5 text-[14px] leading-relaxed text-slate-500">
          Three modes, one debrief. Pick the format that matches your next real interview.
        </p>
      </div>

      {/* Mode cards */}
      <InterviewHubCards />

      {/* Recommended + recent */}
      <RecommendedJobsList />
      <RecentSessionsList />
    </div>
  )
}
