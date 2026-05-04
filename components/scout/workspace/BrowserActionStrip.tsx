"use client"

/**
 * Browser Action Strip — compact, non-intrusive UI strip.
 *
 * Shows the current browser operator action inline between the
 * command bar and the workspace. Appears and disappears automatically.
 *
 * Three states:
 *   running      — "Scout prepared autofill…"    + dismiss ×
 *   pending      — "Scout wants to upload resume"  + Allow + Cancel
 *   blocked/fail — "Could not complete — reason"   + dismiss ×
 */

import { AlertTriangle, Check, CheckCircle2, Loader2, Shield, X } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ScoutBrowserActionEvent } from "@/lib/scout/browser-operator/types"

type Props = {
  action:   ScoutBrowserActionEvent
  onApprove?: (id: string) => void
  onCancel:   (id: string) => void
  onDismiss:  (id: string) => void
}

export function BrowserActionStrip({ action, onApprove, onCancel, onDismiss }: Props) {
  const { id, status, summary, requiresApproval } = action

  // ── Appearance ─────────────────────────────────────────────────────────────

  const isRunning   = status === "running"
  const isPending   = status === "pending"
  const isCompleted = status === "completed"
  const isError     = status === "failed" || status === "blocked"

  const stripCls = cn(
    "flex items-center gap-3 border-b px-5 py-2.5 text-[11px] transition-all",
    isPending ? "border-amber-200 bg-amber-50" :
    isError   ? "border-red-100   bg-red-50/60" :
    isCompleted ? "border-emerald-100 bg-emerald-50/60" :
                  "border-slate-100  bg-white",
  )

  // ── Icon ───────────────────────────────────────────────────────────────────

  const Icon = isRunning  ? Loader2 :
               isPending  ? Shield :
               isCompleted ? CheckCircle2 :
               AlertTriangle

  const iconCls = cn(
    "h-3.5 w-3.5 flex-shrink-0",
    isRunning   ? "animate-spin text-[#FF5C18]" :
    isPending   ? "text-amber-500" :
    isCompleted ? "text-emerald-500" :
                  "text-red-500",
  )

  // ── Text colour ────────────────────────────────────────────────────────────

  const textCls = cn(
    "flex-1 font-medium leading-snug",
    isPending   ? "text-amber-800" :
    isError     ? "text-red-700" :
    isCompleted ? "text-emerald-700" :
                  "text-slate-700",
  )

  return (
    <div className={stripCls}>
      <Icon className={iconCls} />
      <p className={textCls}>{summary ?? "Scout is preparing a browser action…"}</p>

      <div className="flex flex-shrink-0 items-center gap-1.5">
        {/* Pending approval: Allow + Cancel */}
        {isPending && requiresApproval && (
          <>
            <button
              type="button"
              onClick={() => onApprove?.(id)}
              className="inline-flex items-center gap-1 rounded-lg bg-amber-700 px-2.5 py-1 text-[10px] font-semibold text-white transition hover:bg-amber-800"
            >
              <Check className="h-3 w-3" />
              Allow
            </button>
            <button
              type="button"
              onClick={() => onCancel(id)}
              className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-[10px] font-semibold text-amber-700 transition hover:bg-amber-50"
            >
              Cancel
            </button>
          </>
        )}

        {/* Running: cancel only */}
        {isRunning && (
          <button
            type="button"
            onClick={() => onCancel(id)}
            title="Cancel action"
            className="rounded text-slate-400 transition hover:text-slate-600"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}

        {/* Completed / error: dismiss */}
        {(isCompleted || isError) && (
          <button
            type="button"
            onClick={() => onDismiss(id)}
            title="Dismiss"
            className={cn(
              "rounded transition",
              isError ? "text-red-400 hover:text-red-600" : "text-emerald-400 hover:text-emerald-600",
            )}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}
