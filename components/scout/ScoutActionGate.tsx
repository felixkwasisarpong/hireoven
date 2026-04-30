"use client"

import { ShieldAlert, X } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ScoutPermission } from "@/lib/scout/permissions"
import { PERMISSION_LABELS } from "@/lib/scout/permissions"

export type GateRequest = {
  actionType: string
  permission: ScoutPermission
  title: string
  description: string
}

type Props = {
  gate: GateRequest
  onAllowOnce: () => void
  onAlwaysAllow: () => void
  onCancel: () => void
}

export function ScoutActionGate({ gate, onAllowOnce, onAlwaysAllow, onCancel }: Props) {
  return (
    <div
      className={cn(
        "fixed bottom-24 left-1/2 z-50 w-[min(460px,calc(100vw-32px))] -translate-x-1/2",
        "overflow-hidden rounded-2xl border border-slate-200 bg-white",
        "shadow-[0_8px_32px_rgba(15,23,42,0.18)] animate-in slide-in-from-bottom-4 duration-200",
      )}
      role="dialog"
      aria-modal="true"
      aria-label="Scout permission request"
    >
      {/* Header */}
      <div className="flex items-start gap-3 border-b border-slate-100 px-5 py-4">
        <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#FF5C18]" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold leading-5 text-slate-900">{gate.title}</p>
          <p className="mt-0.5 text-[12px] leading-4.5 text-slate-500">{gate.description}</p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="flex-shrink-0 rounded p-0.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          aria-label="Cancel"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Permission scope note */}
      <div className="bg-slate-50 px-5 py-2.5">
        <p className="text-[11px] text-slate-400">
          Permission: <span className="font-semibold text-slate-600">{PERMISSION_LABELS[gate.permission].name}</span>
          {" · "}
          Original data is never deleted or submitted automatically.
        </p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 px-5 py-3.5">
        <button
          type="button"
          onClick={onAllowOnce}
          className="inline-flex flex-1 items-center justify-center rounded-xl border border-[#FF5C18]/30 bg-[#FF5C18]/6 px-4 py-2 text-[12px] font-semibold text-[#FF5C18] transition hover:bg-[#FF5C18]/12"
        >
          Allow once
        </button>
        <button
          type="button"
          onClick={onAlwaysAllow}
          className="inline-flex flex-1 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-[12px] font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
        >
          Always allow
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center justify-center rounded-xl px-4 py-2 text-[12px] font-semibold text-slate-400 transition hover:text-slate-600"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
