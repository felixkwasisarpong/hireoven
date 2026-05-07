"use client"

import { Mic } from "lucide-react"
import InterviewHubCards from "@/components/interview/InterviewHubCards"
import RecommendedJobsList from "@/components/interview/RecommendedJobsList"
import RecentSessionsList from "@/components/interview/RecentSessionsList"

export default function InterviewHubPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      {/* Page header */}
      <div className="mb-8 flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-orange-500">
          <Mic className="h-5 w-5" strokeWidth={2} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-900">Interview</h1>
          <p className="text-[13px] text-slate-500">
            Practice for the roles in your pipeline. Three modes, one debrief.
          </p>
        </div>
      </div>

      {/* Mode cards */}
      <InterviewHubCards />

      {/* Recommended + recent — fetch their own data */}
      <RecommendedJobsList />
      <RecentSessionsList />
    </div>
  )
}
