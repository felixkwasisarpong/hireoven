"use client"

import { Layers, Sparkles } from "lucide-react"
import { ApexCareerTwinCard } from "@/components/apex/ApexCareerTwinCard"
import type { CareerTwinSnapshot } from "@/lib/apex/career-twin/types"

type Props = {
  narrative: string
  workspaceModeLabel: string
  careerTwin: CareerTwinSnapshot | null
  careerTwinHistory?: CareerTwinSnapshot[]
  careerTwinLoading?: boolean
  careerTwinRefreshing?: boolean
  careerTwinError?: string | null
  onRefreshCareerTwin?: () => void
}

function SectionLabel({ label }: { label: string }) {
  return (
    <p className="mb-3 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">
      <Layers className="h-3 w-3" />
      {label}
    </p>
  )
}

export function ApexRightPanel({
  narrative,
  workspaceModeLabel,
  careerTwin,
  careerTwinHistory = [],
  careerTwinLoading = false,
  careerTwinRefreshing = false,
  careerTwinError = null,
  onRefreshCareerTwin,
}: Props) {
  return (
    <aside className="flex h-full w-[252px] flex-shrink-0 flex-col gap-4 overflow-y-auto border-l border-slate-200/60 bg-[#FAFAFA] px-4 py-4">
      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
        <SectionLabel label="Current Task" />
        <div className="flex items-start gap-2">
          <span className="relative mt-1.5 flex h-2.5 w-2.5 flex-shrink-0 items-center justify-center">
            <span className="absolute h-2.5 w-2.5 animate-ping rounded-full bg-blue-500/30" />
            <span className="relative h-2.5 w-2.5 rounded-full bg-blue-600" />
          </span>
          <div className="min-w-0">
            <p className="text-[12px] leading-5 text-slate-600">
              {narrative || "Apex is actively processing your request."}
            </p>
            {workspaceModeLabel && workspaceModeLabel !== "Ready" && (
              <p className="mt-2 inline-flex items-center gap-1 rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-blue-700">
                <Sparkles className="h-3 w-3" />
                {workspaceModeLabel}
              </p>
            )}
          </div>
        </div>
        <div className="relative mt-4 h-[2px] overflow-hidden rounded-full bg-slate-100">
          <div className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-blue-200/0 via-blue-500 to-blue-200/0 animate-[apex-shimmer_1.8s_ease-in-out_infinite]" />
        </div>
      </div>

      <ApexCareerTwinCard
        twin={careerTwin}
        history={careerTwinHistory}
        isLoading={careerTwinLoading}
        isRefreshing={careerTwinRefreshing}
        error={careerTwinError}
        onRefresh={onRefreshCareerTwin}
        variant="compact"
      />
    </aside>
  )
}
