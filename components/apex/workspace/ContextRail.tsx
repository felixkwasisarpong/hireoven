"use client"

import Link from "next/link"
import { ArrowUpRight, X } from "lucide-react"
import type { ScoutAction } from "@/lib/scout/types"
import type { WorkspaceRail } from "@/lib/scout/workspace"

type Props = {
  rail: WorkspaceRail
  onClose: () => void
}

function ActionItem({ action }: { action: ScoutAction }) {
  const label = action.label ?? action.type.replace(/_/g, " ").toLowerCase()

  if (action.type === "OPEN_JOB") {
    return (
      <Link
        href={`/dashboard/jobs/${action.payload.jobId}`}
        className="group flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-medium text-gray-700 transition hover:border-[#FF5C18]/30 hover:text-[#FF5C18]"
      >
        <span className="flex-1 capitalize">{label}</span>
        <ArrowUpRight className="h-3.5 w-3.5 flex-shrink-0 text-gray-300 group-hover:text-[#FF5C18]" />
      </Link>
    )
  }

  if (action.type === "OPEN_COMPANY") {
    return (
      <Link
        href={`/dashboard/companies/${action.payload.companyId}`}
        className="group flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-medium text-gray-700 transition hover:border-[#FF5C18]/30 hover:text-[#FF5C18]"
      >
        <span className="flex-1 capitalize">{label}</span>
        <ArrowUpRight className="h-3.5 w-3.5 flex-shrink-0 text-gray-300 group-hover:text-[#FF5C18]" />
      </Link>
    )
  }

  if (action.type === "OPEN_RESUME_TAILOR") {
    const href = action.payload.jobId
      ? `/dashboard/resume/tailor?jobId=${action.payload.jobId}`
      : "/dashboard/resume/tailor"
    return (
      <Link
        href={href}
        className="group flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-medium text-gray-700 transition hover:border-[#FF5C18]/30 hover:text-[#FF5C18]"
      >
        <span className="flex-1 capitalize">{label}</span>
        <ArrowUpRight className="h-3.5 w-3.5 flex-shrink-0 text-gray-300 group-hover:text-[#FF5C18]" />
      </Link>
    )
  }

  // Generic action — display only
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5">
      <p className="text-xs font-medium capitalize text-gray-600">{label}</p>
    </div>
  )
}

export function ContextRail({ rail, onClose }: Props) {
  return (
    <div className="flex w-72 flex-shrink-0 flex-col gap-4 xl:w-80">
      {/* Rail card */}
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3.5">
          <div>
            <p className="text-sm font-semibold text-gray-900">{rail.title}</p>
            {rail.summary && (
              <p className="mt-0.5 text-[11px] text-gray-400">{rail.summary}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
            aria-label="Close context panel"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Actions */}
        {rail.actions && rail.actions.length > 0 && (
          <div className="space-y-2 px-4 py-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-400">
              Suggested actions
            </p>
            <div className="space-y-1.5">
              {rail.actions.map((action, i) => (
                <ActionItem key={i} action={action} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
