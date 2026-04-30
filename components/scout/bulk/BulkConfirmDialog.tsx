"use client"

import { Ban, ChevronRight, X } from "lucide-react"
import type { BulkJobItem } from "@/lib/scout/bulk-application/types"

type Props = {
  jobs:          BulkJobItem[]
  onConfirm:     () => void
  onEditList:    () => void
  onCancel:      () => void
}

export function BulkConfirmDialog({ jobs, onConfirm, onEditList, onCancel }: Props) {
  const count = jobs.length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">

        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-100 px-6 py-5">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">Scout Bulk Preparation</p>
            <h2 className="mt-1 text-lg font-bold text-slate-900">
              Prepare {count} application{count !== 1 ? "s" : ""}
            </h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Description */}
        <div className="px-6 py-5">
          <p className="text-sm leading-6 text-slate-600">
            Scout will prepare a tailored resume draft, cover letter, and autofill packet for each role.
            <span className="font-semibold text-slate-800"> You review and submit each application manually.</span>
          </p>

          {/* Job preview list */}
          {jobs.length > 0 && (
            <ul className="mt-4 max-h-40 space-y-1.5 overflow-y-auto">
              {jobs.map((job) => (
                <li
                  key={job.queueId}
                  className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2"
                >
                  <ChevronRight className="h-3 w-3 flex-shrink-0 text-slate-400" />
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-700">
                    {job.jobTitle}
                  </span>
                  {job.company && (
                    <span className="flex-shrink-0 text-xs text-slate-400">{job.company}</span>
                  )}
                  {typeof job.matchScore === "number" && (
                    <span className="flex-shrink-0 rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">
                      {job.matchScore}%
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}

          {/* Safety notice */}
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3.5 py-3">
            <Ban className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-slate-400" />
            <p className="text-xs leading-5 text-slate-500">
              Scout will never submit applications, attach files, or insert content without your explicit approval.
              Sensitive fields are always skipped.
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 border-t border-slate-100 px-6 py-4">
          <button
            type="button"
            onClick={onConfirm}
            className="flex-1 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
          >
            Start preparing
          </button>
          <button
            type="button"
            onClick={onEditList}
            className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Edit list
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-500 transition hover:bg-slate-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
