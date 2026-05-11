"use client"

export const dynamic = "force-dynamic"

import { ClipboardList } from "lucide-react"
import HistoryTable from "@/components/interview/HistoryTable"

export default function InterviewHistoryPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-orange-500">
          <ClipboardList className="h-5 w-5" strokeWidth={2} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-900">Interview history</h1>
          <p className="text-[13px] text-slate-500">
            Every session you&apos;ve run. Filter, review, repeat.
          </p>
        </div>
      </div>

      <HistoryTable />
    </div>
  )
}
