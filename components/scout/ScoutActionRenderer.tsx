"use client"

import { useState } from "react"
import {
  Building2,
  Check,
  CheckCircle2,
  Chrome,
  ExternalLink,
  Eye,
  FileEdit,
  Filter,
  Focus,
  HelpCircle,
  Layers,
  Loader2,
  RefreshCw,
  RotateCcw,
  X,
} from "lucide-react"
import type { ScoutAction } from "@/lib/scout/types"
import type { ScoutActionConfirmation, ScoutActionSource } from "./useScoutActionExecutor"
import { getDefaultActionLabel } from "@/lib/scout/actions"
import { useScoutActionExecutor } from "./useScoutActionExecutor"
import { ScoutAuditPanel } from "./ScoutAuditPanel"

type ScoutActionRendererProps = {
  actions: ScoutAction[]
  /** Where these actions originated — stored in the audit trail. */
  source?: ScoutActionSource
  /** Optional reason passed from the parent context (e.g. chat response answer). */
  reason?: string
}

const ACTION_STYLES: Record<string, { bg: string; text: string; icon: string; border: string }> = {
  OPEN_JOB:           { bg: "bg-blue-50",    text: "text-blue-700",    icon: "text-blue-500",    border: "border-blue-200" },
  APPLY_FILTERS:      { bg: "bg-orange-50",  text: "text-orange-700",  icon: "text-orange-500",  border: "border-orange-200" },
  OPEN_RESUME_TAILOR: { bg: "bg-amber-50",   text: "text-amber-700",   icon: "text-amber-500",   border: "border-amber-200" },
  HIGHLIGHT_JOBS:     { bg: "bg-cyan-50",    text: "text-cyan-700",    icon: "text-cyan-500",    border: "border-cyan-200" },
  OPEN_COMPANY:       { bg: "bg-emerald-50", text: "text-emerald-700", icon: "text-emerald-500", border: "border-emerald-200" },
  SET_FOCUS_MODE:     { bg: "bg-orange-50",  text: "text-orange-700",  icon: "text-orange-500",  border: "border-orange-200" },
  RESET_CONTEXT:           { bg: "bg-slate-50",   text: "text-slate-700",   icon: "text-slate-400",   border: "border-slate-200"  },
  OPEN_EXTENSION_BRIDGE:           { bg: "bg-violet-50",  text: "text-violet-700",  icon: "text-violet-500",  border: "border-violet-200" },
  OPEN_EXTENSION_AUTOFILL_PREVIEW: { bg: "bg-orange-50",  text: "text-orange-700",  icon: "text-orange-500",  border: "border-orange-200" },
  PREPARE_TAILORED_AUTOFILL:       { bg: "bg-indigo-50",  text: "text-indigo-700",  icon: "text-indigo-500",  border: "border-indigo-200" },
}

function getActionIcon(action: ScoutAction) {
  switch (action.type) {
    case "OPEN_JOB":           return <ExternalLink className="h-3.5 w-3.5" />
    case "APPLY_FILTERS":      return <Filter className="h-3.5 w-3.5" />
    case "OPEN_RESUME_TAILOR": return <FileEdit className="h-3.5 w-3.5" />
    case "HIGHLIGHT_JOBS":     return <Eye className="h-3.5 w-3.5" />
    case "OPEN_COMPANY":       return <Building2 className="h-3.5 w-3.5" />
    case "SET_FOCUS_MODE":     return <Focus className="h-3.5 w-3.5" />
    case "RESET_CONTEXT":           return <RefreshCw className="h-3.5 w-3.5" />
    case "OPEN_EXTENSION_BRIDGE":           return <Chrome className="h-3.5 w-3.5" />
    case "OPEN_EXTENSION_AUTOFILL_PREVIEW": return <Chrome className="h-3.5 w-3.5" />
    case "PREPARE_TAILORED_AUTOFILL":       return <Layers className="h-3.5 w-3.5" />
    default:                                return <ExternalLink className="h-3.5 w-3.5" />
  }
}

function getActionDescription(action: ScoutAction): string | null {
  switch (action.type) {
    case "APPLY_FILTERS": {
      const filters: string[] = []
      if (action.payload.query)       filters.push(`"${action.payload.query}"`)
      if (action.payload.location)    filters.push(action.payload.location)
      if (action.payload.workMode)    filters.push(action.payload.workMode)
      if (action.payload.sponsorship) filters.push(`${action.payload.sponsorship} sponsorship`)
      return filters.length > 0 ? filters.join(" · ") : null
    }
    case "HIGHLIGHT_JOBS":
      return action.payload.reason || `${action.payload.jobIds.length} jobs`
    default:
      return null
  }
}

// ── Confirmation banner ────────────────────────────────────────────────────

function ConfirmationBanner({
  confirmation,
  onUndo,
  onDismiss,
}: {
  confirmation: ScoutActionConfirmation
  onUndo: () => void
  onDismiss: () => void
}) {
  const [showAudit, setShowAudit] = useState(false)
  const hasAudit = !!confirmation.auditEntry

  return (
    <div className="overflow-hidden rounded-xl border border-emerald-200 bg-emerald-50 shadow-[0_2px_8px_rgba(5,150,105,0.08)]">
      <div className="flex items-start gap-3 p-4">
        {/* Check icon */}
        <div className="mt-0.5 flex-shrink-0 inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500">
          <Check className="h-3.5 w-3.5 text-white" />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-baseline gap-2">
            <p className="text-sm font-semibold text-emerald-900">{confirmation.title}</p>
            {confirmation.jobCount !== undefined && confirmation.jobCount > 0 && (
              <span className="text-xs font-medium text-emerald-600">
                Showing {confirmation.jobCount.toLocaleString()} job{confirmation.jobCount !== 1 ? "s" : ""}
              </span>
            )}
          </div>
          <ul className="mt-1.5 space-y-1">
            {confirmation.details.map((detail, i) => (
              <li key={i} className="flex items-center gap-2 text-xs text-emerald-700">
                <span className="h-1 w-1 flex-shrink-0 rounded-full bg-emerald-400" />
                {detail}
              </li>
            ))}
          </ul>
          {hasAudit && (
            <button
              type="button"
              onClick={() => setShowAudit((v) => !v)}
              className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 transition hover:text-emerald-800"
            >
              <HelpCircle className="h-3 w-3" />
              {showAudit ? "Hide details" : "Why this?"}
            </button>
          )}
        </div>

        {/* Actions */}
        <div className="ml-2 flex flex-shrink-0 items-center gap-1.5">
          {confirmation.canUndo && (
            <button
              type="button"
              onClick={onUndo}
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-white px-2.5 py-1 text-xs font-semibold text-emerald-700 transition hover:border-emerald-400 hover:bg-emerald-50 active:scale-95"
            >
              <RotateCcw className="h-3 w-3" />
              Undo
            </button>
          )}
          <button
            type="button"
            onClick={onDismiss}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-emerald-500 transition hover:bg-emerald-100 hover:text-emerald-700"
            aria-label="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Inline audit panel */}
      {showAudit && confirmation.auditEntry && (
        <div className="border-t border-emerald-200 bg-white px-4 pb-4 pt-0">
          <ScoutAuditPanel
            entry={confirmation.auditEntry}
            onUndo={confirmation.canUndo ? onUndo : undefined}
            onClose={() => setShowAudit(false)}
          />
        </div>
      )}
    </div>
  )
}

// ── Main renderer ──────────────────────────────────────────────────────────

export function ScoutActionRenderer({ actions, source, reason }: ScoutActionRendererProps) {
  // Tracks which action indices are permanently applied
  const [executedActions, setExecutedActions] = useState<Set<number>>(new Set())
  // Tracks which action is currently being processed (brief disabled state)
  const [processingActions, setProcessingActions] = useState<Set<number>>(new Set())

  const {
    executeAction,
    feedback,
    highlightedJobs,
    confirmation,
    dismissConfirmation,
    executeUndo,
  } = useScoutActionExecutor()

  if (!actions || actions.length === 0) return null

  function handleClick(action: ScoutAction, index: number) {
    if (executedActions.has(index) || processingActions.has(index)) return

    // Mark as processing immediately for instant visual feedback
    setProcessingActions((prev) => new Set(prev).add(index))

    executeAction(action, {
      source,
      reason,
      onExecuted: () => {
        setProcessingActions((prev) => {
          const next = new Set(prev)
          next.delete(index)
          return next
        })
        setExecutedActions((prev) => new Set(prev).add(index))
      },
    })
  }

  return (
    <div className="mt-5 space-y-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">
        Suggested Actions
      </p>

      <div className="flex flex-wrap gap-2">
        {actions.map((action, index) => {
          const isExecuted = executedActions.has(index)
          const isProcessing = processingActions.has(index)
          const label = action.label || getDefaultActionLabel(action)
          const description = getActionDescription(action)
          const style = ACTION_STYLES[action.type] ?? ACTION_STYLES.OPEN_JOB

          return (
            <button
              key={index}
              type="button"
              onClick={() => handleClick(action, index)}
              disabled={isExecuted || isProcessing}
              title={description ?? undefined}
              className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition ${
                isExecuted
                  ? "cursor-default border-emerald-200 bg-emerald-50 text-emerald-700 opacity-70"
                  : isProcessing
                  ? "cursor-wait border-slate-200 bg-slate-100 text-slate-400"
                  : `${style.border} ${style.bg} ${style.text} hover:opacity-90 active:scale-95`
              }`}
            >
              <span
                className={
                  isExecuted
                    ? "text-emerald-500"
                    : isProcessing
                    ? "text-slate-400"
                    : style.icon
                }
              >
                {isExecuted ? (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                ) : isProcessing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  getActionIcon(action)
                )}
              </span>

              {isExecuted ? `${label} — applied` : label}

              {description && !isExecuted && !isProcessing && (
                <span className="max-w-[160px] truncate opacity-60">— {description}</span>
              )}
            </button>
          )
        })}
      </div>

      {/* Confirmation banner — shown for APPLY_FILTERS and HIGHLIGHT_JOBS */}
      {confirmation && (
        <ConfirmationBanner
          confirmation={confirmation}
          onUndo={executeUndo}
          onDismiss={dismissConfirmation}
        />
      )}

      {/* Simple feedback for navigation actions (OPEN_JOB, etc.) */}
      {feedback && !confirmation && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs font-medium text-slate-600">
          {feedback}
        </div>
      )}

      {/* Highlighted jobs notice (only if no banner already shown) */}
      {highlightedJobs.length > 0 && !confirmation && (
        <div className="rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-3">
          <p className="text-sm font-semibold text-cyan-900">
            {highlightedJobs.length} job{highlightedJobs.length !== 1 ? "s" : ""} highlighted
          </p>
          <p className="mt-0.5 text-xs text-cyan-700">
            Visual only — not persisted across sessions.
          </p>
        </div>
      )}
    </div>
  )
}
