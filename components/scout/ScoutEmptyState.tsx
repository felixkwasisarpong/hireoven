"use client"

/**
 * ScoutEmptyState — consistent fallback for all Scout workspace modes.
 *
 * Use this when a Scout mode panel has nothing to show:
 *   - loading    → spinner + label
 *   - empty      → icon + message + optional action
 *   - error      → alert icon + message + retry
 *   - unsupported→ info + manual guidance
 *   - needs_action → prompt with CTA
 *
 * No blank panels — every Scout surface should show one of these states.
 */

import {
  AlertCircle,
  ArrowRight,
  Info,
  Loader2,
  MessageSquare,
  Sparkles,
} from "lucide-react"
import { cn } from "@/lib/utils"

// ── Types ─────────────────────────────────────────────────────────────────────

export type ScoutEmptyStateType =
  | "loading"
  | "empty"
  | "error"
  | "unsupported"
  | "needs_action"

type Props = {
  type:      ScoutEmptyStateType
  title?:    string
  message?:  string
  /** Single primary action (retry, open, etc.) */
  action?: {
    label:   string
    onClick: () => void
  }
  /** Show condensed single-line style instead of card */
  compact?:  boolean
  className?: string
}

// ── Icon + colour per state ───────────────────────────────────────────────────

const STATE_CONFIG: Record<
  ScoutEmptyStateType,
  {
    icon:    React.ElementType
    iconCls: string
    bg:      string
    border:  string
    title:   string
    message: string
  }
> = {
  loading: {
    icon:    Loader2,
    iconCls: "animate-spin text-[#FF5C18]",
    bg:      "bg-white",
    border:  "border-slate-100",
    title:   "Loading…",
    message: "Preparing your Scout workspace.",
  },
  empty: {
    icon:    Sparkles,
    iconCls: "text-slate-300",
    bg:      "bg-white",
    border:  "border-slate-100",
    title:   "Nothing here yet",
    message: "Ask Scout a question to get started.",
  },
  error: {
    icon:    AlertCircle,
    iconCls: "text-red-400",
    bg:      "bg-red-50/60",
    border:  "border-red-100",
    title:   "Something went wrong",
    message: "Scout hit an error loading this section. Try again.",
  },
  unsupported: {
    icon:    Info,
    iconCls: "text-slate-400",
    bg:      "bg-slate-50",
    border:  "border-slate-200",
    title:   "Not available here",
    message: "This feature isn't supported in the current context.",
  },
  needs_action: {
    icon:    MessageSquare,
    iconCls: "text-[#FF5C18]/70",
    bg:      "bg-orange-50/40",
    border:  "border-orange-100",
    title:   "Action needed",
    message: "Scout needs a little more context to help here.",
  },
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ScoutEmptyState({ type, title, message, action, compact, className }: Props) {
  const cfg  = STATE_CONFIG[type]
  const Icon = cfg.icon

  if (compact) {
    return (
      <div className={cn("flex items-center gap-2.5 py-3", className)}>
        <Icon className={cn("h-3.5 w-3.5 flex-shrink-0", cfg.iconCls)} />
        <p className="text-xs text-slate-500">{title ?? cfg.title}</p>
        {action && (
          <button
            type="button"
            onClick={action.onClick}
            className="ml-auto text-[11px] font-semibold text-[#FF5C18] hover:underline"
          >
            {action.label}
          </button>
        )}
      </div>
    )
  }

  return (
    <div className={cn(
      "flex flex-col items-start gap-3 rounded-xl border px-4 py-5",
      cfg.bg, cfg.border, className,
    )}>
      <div className="flex items-start gap-3">
        <Icon className={cn("mt-0.5 h-4 w-4 flex-shrink-0", cfg.iconCls)} />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-800">{title ?? cfg.title}</p>
          <p className="mt-0.5 text-xs leading-4 text-slate-500">{message ?? cfg.message}</p>
        </div>
      </div>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-700 shadow-sm transition hover:border-slate-400 hover:bg-slate-50"
        >
          {action.label}
          <ArrowRight className="h-3 w-3 text-slate-400" />
        </button>
      )}
    </div>
  )
}
