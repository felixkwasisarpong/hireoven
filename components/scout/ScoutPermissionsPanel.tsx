"use client"

import { Ban, ChevronRight, RotateCcw, Shield, ShieldCheck, X } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ScoutPermission, ScoutPermissionState } from "@/lib/scout/permissions"
import {
  PERMISSION_LABELS,
  getDefaultPermissions,
  resetPermissions,
  updatePermission,
  readAuditLog,
  clearAuditLog,
} from "@/lib/scout/permissions"
import { Check } from "lucide-react"

// Permissions that start unlocked (no confirmation required by default)
const READ_ONLY_PERMS = new Set<ScoutPermission>(["read_jobs", "read_resume"])

// Hard-blocked actions shown as a static row at the bottom
const HARD_BLOCKED_DISPLAY = [
  { label: "Auto-submit applications", reason: "Always blocked — you click Submit" },
  { label: "Silent resume overwrite",  reason: "Always blocked — originals are preserved" },
  { label: "Auto-answer legal fields", reason: "Always blocked — visa/legal fields require your input" },
]

type Props = {
  permissions: ScoutPermissionState[]
  onPermissionsChange: (updated: ScoutPermissionState[]) => void
  onClose: () => void
}

function PermRow({
  state,
  onChange,
}: {
  state: ScoutPermissionState
  onChange: (patch: Partial<Pick<ScoutPermissionState, "allowed" | "requiresConfirmation">>) => void
}) {
  const meta = PERMISSION_LABELS[state.permission]
  const isReadOnly = READ_ONLY_PERMS.has(state.permission)

  return (
    <div className={cn(
      "flex items-start gap-3 py-3 transition-colors",
      !state.allowed && "opacity-60"
    )}>
      {/* Status dot */}
      <span className={cn(
        "mt-1 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full text-[9px]",
        state.allowed ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-400"
      )}>
        {state.allowed ? <Check className="h-2.5 w-2.5" /> : <X className="h-2.5 w-2.5" />}
      </span>

      {/* Label */}
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-semibold text-slate-900">{meta.name}</p>
        <p className="text-[11px] text-slate-400">{meta.description}</p>

        {/* Confirmation toggle (only for non-read-only permissions) */}
        {state.allowed && !isReadOnly && (
          <button
            type="button"
            onClick={() => onChange({ requiresConfirmation: !state.requiresConfirmation })}
            className={cn(
              "mt-1.5 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold transition",
              state.requiresConfirmation
                ? "bg-amber-50 text-amber-700 hover:bg-amber-100"
                : "bg-slate-100 text-slate-500 hover:bg-slate-200"
            )}
          >
            {state.requiresConfirmation ? "Ask before each use" : "Always allow"}
          </button>
        )}
        {isReadOnly && state.allowed && (
          <span className="mt-1.5 inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
            Always allowed
          </span>
        )}
      </div>

      {/* Enable/disable toggle */}
      {!isReadOnly && (
        <button
          type="button"
          onClick={() => onChange({ allowed: !state.allowed, requiresConfirmation: true })}
          className={cn(
            "mt-0.5 flex-shrink-0 rounded-full transition-colors",
            "h-5 w-9 border",
            state.allowed
              ? "border-[#FF5C18]/30 bg-[#FF5C18]"
              : "border-slate-200 bg-slate-100"
          )}
          aria-label={state.allowed ? "Disable permission" : "Enable permission"}
        >
          <span className={cn(
            "block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform",
            state.allowed ? "translate-x-[18px]" : "translate-x-[2px]"
          )} />
        </button>
      )}
    </div>
  )
}

export function ScoutPermissionsPanel({ permissions, onPermissionsChange, onClose }: Props) {
  const auditLog = readAuditLog()

  function handleChange(
    permission: ScoutPermission,
    patch: Partial<Pick<ScoutPermissionState, "allowed" | "requiresConfirmation">>,
  ) {
    const updated = updatePermission(permissions, permission, patch)
    onPermissionsChange(updated)
  }

  function handleReset() {
    resetPermissions()
    onPermissionsChange(getDefaultPermissions())
  }

  const allowedCount = permissions.filter((p) => p.allowed).length

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-slate-900/20 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-sm bg-white shadow-2xl border-l border-slate-200 flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-slate-100 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="h-7 w-7 rounded-lg bg-[#FF5C18]/10 flex items-center justify-center flex-shrink-0">
              <Shield className="h-4 w-4 text-[#FF5C18]" />
            </div>
            <div>
              <div className="text-sm font-bold text-slate-900">Scout Permissions</div>
              <div className="text-[10px] text-slate-400">
                {allowedCount} of {permissions.length} actions allowed
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition"
            aria-label="Close permissions panel"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Privacy notice */}
        <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-100 flex-shrink-0">
          <p className="text-[10.5px] text-slate-500 leading-relaxed">
            Control exactly what Scout can do on your behalf.{" "}
            <strong className="text-slate-600">You approve every sensitive action.</strong>{" "}
            Toggle off anything you&apos;d prefer to handle manually.
          </p>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-1">
          <div className="divide-y divide-slate-50">
            {permissions.map((state) => (
              <PermRow
                key={state.permission}
                state={state}
                onChange={(patch) => handleChange(state.permission, patch)}
              />
            ))}
          </div>

          {/* Hard-blocked section */}
          <div className="mt-2 border-t border-slate-100 pt-3 pb-4">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
              Always blocked — cannot be changed
            </p>
            {HARD_BLOCKED_DISPLAY.map((item) => (
              <div key={item.label} className="flex items-start gap-3 py-2 opacity-60">
                <Ban className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-red-400" />
                <div>
                  <p className="text-[11.5px] font-semibold text-slate-700">{item.label}</p>
                  <p className="text-[10.5px] text-slate-400">{item.reason}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Audit log */}
          {auditLog.length > 0 && (
            <div className="border-t border-slate-100 py-3">
              <div className="flex items-center justify-between mb-1">
                <p className="text-[11px] font-semibold text-slate-500">
                  {auditLog.length} action{auditLog.length !== 1 ? "s" : ""} this session
                </p>
                <button
                  type="button"
                  onClick={clearAuditLog}
                  className="text-[10.5px] text-slate-400 transition hover:text-slate-600"
                >
                  Clear
                </button>
              </div>
              <div className="space-y-1">
                {auditLog.slice(0, 8).map((entry, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <ShieldCheck className="h-3 w-3 text-slate-300 flex-shrink-0" />
                    <span className="text-[10.5px] text-slate-500 truncate">{entry.actionType}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-slate-100 px-4 py-3 flex items-center justify-between flex-shrink-0">
          <button
            type="button"
            onClick={handleReset}
            className="inline-flex items-center gap-1.5 text-[11.5px] text-slate-400 transition hover:text-slate-600"
          >
            <RotateCcw className="h-3 w-3" />
            Reset to defaults
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-[#FF5C18] transition hover:text-[#c94010]"
          >
            Done <ChevronRight className="h-3 w-3" />
          </button>
        </div>
      </div>
    </>
  )
}
