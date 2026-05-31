"use client"

import { useEffect, useState } from "react"
import {
  AlertTriangle,
  CheckCircle2,
  Lightbulb,
  Loader2,
  X,
} from "lucide-react"
import type { ScoutNudge, ScoutNudgeSeverity } from "@/lib/scout/nudges"
import { getDefaultActionLabel } from "@/lib/scout/actions"
import { useScoutActionExecutor } from "./useScoutActionExecutor"

type ScoutNudgeStripProps = {
  nudges: ScoutNudge[]
}

const SEVERITY_CONFIG: Record<
  ScoutNudgeSeverity,
  {
    border: string
    bg: string
    titleColor: string
    descColor: string
    dotColor: string
    iconBg: string
    iconColor: string
    actionBorder: string
    actionBg: string
    actionText: string
    actionHover: string
  }
> = {
  warning: {
    border: "border-amber-200/70",
    bg: "bg-amber-50/60",
    titleColor: "text-amber-900",
    descColor: "text-amber-800",
    dotColor: "bg-amber-400",
    iconBg: "bg-amber-100",
    iconColor: "text-amber-600",
    actionBorder: "border-amber-300",
    actionBg: "bg-white",
    actionText: "text-amber-800",
    actionHover: "hover:bg-amber-50",
  },
  opportunity: {
    border: "border-emerald-200/70",
    bg: "bg-emerald-50/50",
    titleColor: "text-emerald-900",
    descColor: "text-emerald-800",
    dotColor: "bg-emerald-400",
    iconBg: "bg-emerald-100",
    iconColor: "text-emerald-600",
    actionBorder: "border-emerald-300",
    actionBg: "bg-white",
    actionText: "text-emerald-800",
    actionHover: "hover:bg-emerald-50",
  },
  info: {
    border: "border-blue-200/70",
    bg: "bg-blue-50/50",
    titleColor: "text-blue-900",
    descColor: "text-blue-800",
    dotColor: "bg-blue-400",
    iconBg: "bg-blue-100",
    iconColor: "text-blue-600",
    actionBorder: "border-blue-300",
    actionBg: "bg-white",
    actionText: "text-blue-800",
    actionHover: "hover:bg-blue-50",
  },
}

function NudgeIcon({ severity }: { severity: ScoutNudgeSeverity }) {
  const cfg = SEVERITY_CONFIG[severity]
  const Icon =
    severity === "warning"
      ? AlertTriangle
      : severity === "opportunity"
      ? Lightbulb
      : CheckCircle2

  return (
    <div
      className={`flex-shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-lg ${cfg.iconBg}`}
    >
      <Icon className={`h-3.5 w-3.5 ${cfg.iconColor}`} />
    </div>
  )
}

function NudgeCard({
  nudge,
  onDismiss,
}: {
  nudge: ScoutNudge
  onDismiss: () => void
}) {
  const cfg = SEVERITY_CONFIG[nudge.severity]
  const { executeAction, feedback } = useScoutActionExecutor()
  const [actionDone, setActionDone] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)

  function handleAction() {
    if (!nudge.action || actionDone || actionLoading) return
    setActionLoading(true)
    executeAction(nudge.action, {
      source: "nudge",
      reason: nudge.description,
      onExecuted: () => {
        setActionLoading(false)
        setActionDone(true)
        // Auto-dismiss after a brief delay so user sees the "done" state
        setTimeout(onDismiss, 1200)
      },
    })
  }

  return (
    <div
      className={`flex items-start gap-3 rounded-[14px] border px-4 py-3 ${cfg.border} ${cfg.bg}`}
    >
      <NudgeIcon severity={nudge.severity} />

      <div className="flex-1 min-w-0">
        <p className={`text-xs font-semibold leading-5 ${cfg.titleColor}`}>{nudge.title}</p>
        <p className={`mt-0.5 text-xs leading-5 ${cfg.descColor} opacity-90`}>
          {nudge.description}
        </p>

        {nudge.action && !actionDone && (
          <button
            type="button"
            onClick={handleAction}
            disabled={actionLoading}
            className={`mt-2.5 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold transition disabled:opacity-50 ${cfg.actionBorder} ${cfg.actionBg} ${cfg.actionText} ${cfg.actionHover}`}
          >
            {actionLoading && <Loader2 className="h-3 w-3 animate-spin" />}
            {nudge.action.label ?? getDefaultActionLabel(nudge.action)}
          </button>
        )}

        {actionDone && (
          <span className="mt-2.5 inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
            <CheckCircle2 className="h-3 w-3" />
            Done
          </span>
        )}

        {feedback && actionDone && (
          <span className="ml-2 text-[11px] text-slate-500">{feedback}</span>
        )}
      </div>

      <button
        type="button"
        onClick={onDismiss}
        className="flex-shrink-0 inline-flex h-6 w-6 items-center justify-center rounded-md text-slate-400 transition hover:bg-black/5 hover:text-slate-600"
        aria-label={`Dismiss nudge: ${nudge.title}`}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

/**
 * Renders up to 3 proactive Scout nudges.
 *
 * - Nudges are passed as props (computed client-side from already-fetched data).
 * - Dismissed state is session-local (cleared on context reset).
 * - No AI calls, no auto-execution.
 */
export function ScoutNudgeStrip({ nudges }: ScoutNudgeStripProps) {
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set())

  // Re-show dismissed nudges when context is reset
  useEffect(() => {
    function onReset() {
      setDismissedIds(new Set())
    }
    window.addEventListener("scout:reset-context", onReset)
    return () => window.removeEventListener("scout:reset-context", onReset)
  }, [])

  const visible = nudges.filter((n) => !dismissedIds.has(n.id))
  if (visible.length === 0) return null

  function dismiss(id: string) {
    setDismissedIds((prev) => new Set(prev).add(id))
  }

  return (
    <div className="space-y-2" role="region" aria-label="Scout suggestions">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
        Scout suggests
      </p>
      {visible.map((nudge) => (
        <NudgeCard key={nudge.id} nudge={nudge} onDismiss={() => dismiss(nudge.id)} />
      ))}
    </div>
  )
}

/**
 * Compact variant for the ScoutMiniPanel — renders nudges without the section label.
 */
export function ScoutNudgeStripCompact({ nudges }: ScoutNudgeStripProps) {
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    function onReset() {
      setDismissedIds(new Set())
    }
    window.addEventListener("scout:reset-context", onReset)
    return () => window.removeEventListener("scout:reset-context", onReset)
  }, [])

  const visible = nudges.filter((n) => !dismissedIds.has(n.id)).slice(0, 2)
  if (visible.length === 0) return null

  function dismiss(id: string) {
    setDismissedIds((prev) => new Set(prev).add(id))
  }

  return (
    <div className="space-y-1.5">
      {visible.map((nudge) => (
        <NudgeCard key={nudge.id} nudge={nudge} onDismiss={() => dismiss(nudge.id)} />
      ))}
    </div>
  )
}
