"use client"

import { AlertCircle, Bell, Clock3, TrendingUp, X } from "lucide-react"
import type { ScoutProactiveEvent } from "@/lib/scout/proactive/types"
import { cn } from "@/lib/utils"

type Props = {
  event: ScoutProactiveEvent | null
  enabled: boolean
  onOpen: (event: ScoutProactiveEvent) => void
  onDismiss: (eventId: string) => void
  onSnooze: (eventId: string) => void
  onDisable: () => void
}

function severityStyle(severity: ScoutProactiveEvent["severity"]) {
  switch (severity) {
    case "urgent":
      return {
        border: "border-red-200/70",
        bg: "bg-red-50/60",
        text: "text-red-800",
        dot: "bg-red-500",
        icon: AlertCircle,
      }
    case "important":
      return {
        border: "border-amber-200/70",
        bg: "bg-amber-50/70",
        text: "text-amber-900",
        dot: "bg-amber-500",
        icon: TrendingUp,
      }
    default:
      return {
        border: "border-slate-200/80",
        bg: "bg-slate-50/80",
        text: "text-slate-700",
        dot: "bg-slate-400",
        icon: Bell,
      }
  }
}

export function ScoutProactiveStrip({
  event,
  enabled,
  onOpen,
  onDismiss,
  onSnooze,
  onDisable,
}: Props) {
  if (!enabled || !event) return null

  const style = severityStyle(event.severity)
  const Icon = style.icon

  return (
    <div className={cn("mb-3 rounded-xl border px-3 py-2.5", style.border, style.bg)}>
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 flex items-center gap-1.5">
          <span className={cn("h-1.5 w-1.5 rounded-full", style.dot)} />
          <Icon className={cn("h-3.5 w-3.5", style.text)} />
        </div>

        <div className="min-w-0 flex-1">
          <p className={cn("text-[12.5px] font-semibold leading-snug", style.text)}>{event.title}</p>
          <p className="mt-0.5 text-[11px] leading-4.5 text-slate-500">{event.summary}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onOpen(event)}
              className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-semibold text-slate-700 transition hover:border-slate-900 hover:bg-slate-900 hover:text-white"
            >
              Open suggestion
            </button>
            <button
              type="button"
              onClick={() => onSnooze(event.id)}
              className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-medium text-slate-500 transition hover:text-slate-700"
            >
              <Clock3 className="h-3 w-3" />
              Snooze
            </button>
            <button
              type="button"
              onClick={onDisable}
              className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-medium text-slate-400 transition hover:text-slate-600"
            >
              Disable proactive
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={() => onDismiss(event.id)}
          className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-slate-300 transition hover:bg-white hover:text-slate-500"
          aria-label="Dismiss proactive suggestion"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}
