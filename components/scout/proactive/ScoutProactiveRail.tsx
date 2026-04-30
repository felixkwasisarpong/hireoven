"use client"

import { Bell, BellOff, ChevronRight, Clock3, X } from "lucide-react"
import type { ScoutProactiveEvent, ScoutProactiveEventType } from "@/lib/scout/proactive/types"
import { cn } from "@/lib/utils"

type Props = {
  events: ScoutProactiveEvent[]
  enabled: boolean
  mutedCount?: number
  loading?: boolean
  onOpen: (event: ScoutProactiveEvent) => void
  onDismiss: (eventId: string) => void
  onSnooze: (eventId: string) => void
  onMuteType: (type: ScoutProactiveEventType) => void
  onClearMutedTypes?: () => void
  onSetEnabled: (enabled: boolean) => void
}

function severityDot(severity: ScoutProactiveEvent["severity"]): string {
  if (severity === "urgent") return "bg-red-500"
  if (severity === "important") return "bg-amber-500"
  return "bg-slate-400"
}

function EventRow({
  event,
  onOpen,
  onDismiss,
  onSnooze,
  onMuteType,
}: {
  event: ScoutProactiveEvent
  onOpen: (event: ScoutProactiveEvent) => void
  onDismiss: (eventId: string) => void
  onSnooze: (eventId: string) => void
  onMuteType: (type: ScoutProactiveEventType) => void
}) {
  return (
    <div className="rounded-lg border border-slate-200/80 bg-white p-2.5">
      <div className="flex items-start gap-2">
        <span className={cn("mt-1 h-1.5 w-1.5 rounded-full", severityDot(event.severity))} />
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-semibold leading-snug text-slate-800">{event.title}</p>
          <p className="mt-0.5 text-[10.5px] leading-4 text-slate-500">{event.summary}</p>
        </div>
        <button
          type="button"
          onClick={() => onDismiss(event.id)}
          className="rounded p-1 text-slate-300 transition hover:bg-slate-100 hover:text-slate-500"
          aria-label="Dismiss proactive event"
        >
          <X className="h-3 w-3" />
        </button>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => onOpen(event)}
          className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-semibold text-slate-700 transition hover:border-slate-900 hover:bg-slate-900 hover:text-white"
        >
          Open
          <ChevronRight className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={() => onSnooze(event.id)}
          className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-2 py-1 text-[10px] text-slate-500 transition hover:bg-slate-50 hover:text-slate-700"
        >
          <Clock3 className="h-3 w-3" />
          Snooze
        </button>
        <button
          type="button"
          onClick={() => onMuteType(event.type)}
          className="rounded-full border border-slate-200 px-2 py-1 text-[10px] text-slate-400 transition hover:bg-slate-50 hover:text-slate-600"
        >
          Mute type
        </button>
      </div>
    </div>
  )
}

export function ScoutProactiveRail({
  events,
  enabled,
  mutedCount = 0,
  loading = false,
  onOpen,
  onDismiss,
  onSnooze,
  onMuteType,
  onClearMutedTypes,
  onSetEnabled,
}: Props) {
  if (!enabled && !events.length) {
    return (
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_2px_12px_rgba(15,23,42,0.05)]">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <div className="flex items-center gap-2">
            <BellOff className="h-3.5 w-3.5 text-slate-400" />
            <p className="text-[10.5px] font-semibold uppercase tracking-widest text-slate-400">Proactive Scout</p>
          </div>
        </div>
        <div className="px-4 py-3">
          <p className="text-[11px] text-slate-500">Proactive mode is currently disabled.</p>
          <button
            type="button"
            onClick={() => onSetEnabled(true)}
            className="mt-2 rounded-full border border-slate-200 px-2.5 py-1 text-[10px] font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Enable
          </button>
        </div>
      </div>
    )
  }

  if (!enabled) return null
  if (!loading && events.length === 0 && mutedCount === 0) return null

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_2px_12px_rgba(15,23,42,0.05)]">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <div className="flex items-center gap-2">
          <Bell className="h-3.5 w-3.5 text-[#FF5C18]" />
          <p className="text-[10.5px] font-semibold uppercase tracking-widest text-slate-400">Proactive Scout</p>
        </div>
        <button
          type="button"
          onClick={() => onSetEnabled(false)}
          className="rounded-full border border-slate-200 px-2 py-0.5 text-[10px] text-slate-400 transition hover:text-slate-600"
        >
          Disable
        </button>
      </div>

      <div className="space-y-2 px-3 py-3">
        {mutedCount > 0 && onClearMutedTypes && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2">
            <p className="text-[11px] text-slate-500">
              {mutedCount} muted proactive categor{mutedCount === 1 ? "y" : "ies"}.
            </p>
            <button
              type="button"
              onClick={onClearMutedTypes}
              className="mt-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-600 transition hover:bg-slate-100"
            >
              Unmute all
            </button>
          </div>
        )}
        {loading && events.length === 0 && (
          <p className="px-1 text-[11px] text-slate-400">Refreshing proactive signals…</p>
        )}
        {events.map((event) => (
          <EventRow
            key={event.id}
            event={event}
            onOpen={onOpen}
            onDismiss={onDismiss}
            onSnooze={onSnooze}
            onMuteType={onMuteType}
          />
        ))}
      </div>
    </div>
  )
}
