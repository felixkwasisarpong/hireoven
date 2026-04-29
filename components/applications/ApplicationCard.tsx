"use client"

import { useDraggable } from "@dnd-kit/core"
import { Sparkles } from "lucide-react"
import CompanyLogo from "@/components/ui/CompanyLogo"
import { cn } from "@/lib/utils"
import type { JobApplication } from "@/types"

function scoreColor(score: number) {
  if (score >= 70) return "border-emerald-200 bg-emerald-50 text-emerald-700"
  if (score >= 40) return "border-amber-200 bg-amber-50 text-amber-700"
  return "border-red-200 bg-red-50 text-red-700"
}

type Props = {
  application: JobApplication
  onOpen: () => void
}

export function ApplicationCard({ application, onOpen }: Props) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: application.id,
  })

  return (
    <div
      ref={setNodeRef}
      style={transform ? { transform: `translate3d(${transform.x}px,${transform.y}px,0)` } : undefined}
      {...attributes}
      {...listeners}
      onClick={onOpen}
      className={cn(
        "group relative select-none rounded-[14px] border border-slate-200/80 bg-white p-3.5",
        "shadow-[0_1px_0_rgba(15,23,42,0.04),0_4px_12px_rgba(15,23,42,0.04)]",
        "transition-shadow hover:shadow-[0_8px_24px_rgba(15,23,42,0.09)] hover:border-slate-300",
        isDragging ? "cursor-grabbing opacity-40" : "cursor-grab"
      )}
    >
      <div className="flex items-start gap-2.5">
        <CompanyLogo
          companyName={application.company_name}
          domain={application.company_domain ?? undefined}
          logoUrl={application.company_logo_url}
          className="h-9 w-9 rounded-xl"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[10.5px] font-semibold uppercase tracking-[0.18em] text-slate-400">
            {application.company_name}
          </p>
          <p className="mt-0.5 truncate text-[13px] font-semibold leading-snug text-slate-900">
            {application.job_title}
          </p>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {application.match_score != null && (
            <span className={cn("inline-flex items-center gap-0.5 rounded-full border px-2 py-0.5 text-[10.5px] font-semibold", scoreColor(application.match_score))}>
              <Sparkles className="h-3 w-3" />
              {application.match_score}%
            </span>
          )}
          {(application.applied_at ?? application.created_at) && (
            <span className="text-[10.5px] text-slate-400">
              {new Date((application.applied_at ?? application.created_at)!).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            </span>
          )}
        </div>
        {application.interviews?.length > 0 && (
          <span className="rounded-full bg-orange-50 px-2 py-0.5 text-[10.5px] font-semibold text-orange-600">
            {application.interviews.length}×
          </span>
        )}
      </div>
    </div>
  )
}
