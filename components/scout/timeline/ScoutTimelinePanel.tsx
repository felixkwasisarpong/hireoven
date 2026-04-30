"use client"

import {
  AlertCircle,
  ArrowUpLeft,
  Briefcase,
  CheckSquare,
  ChevronDown,
  ChevronUp,
  Clock,
  Globe,
  LayoutGrid,
  Lightbulb,
  MessageSquare,
  Play,
  Search,
  Shield,
  StepForward,
  Trash2,
  X,
  Zap,
} from "lucide-react"
import { useMemo, useState } from "react"
import { cn } from "@/lib/utils"
import type {
  ScoutTimelineEvent,
  ScoutTimelineEventType,
  TimelineFilter,
  ScoutTimelineReplayAction,
} from "@/lib/scout/timeline/types"
import { FILTER_EVENT_TYPES } from "@/lib/scout/timeline/types"

const EVENT_META: Record<
  ScoutTimelineEventType,
  { icon: React.ElementType; label: string; dot: string }
> = {
  command:                 { icon: MessageSquare, label: "Command",           dot: "bg-slate-400"   },
  workspace_change:        { icon: LayoutGrid,    label: "Workspace",         dot: "bg-blue-400"    },
  workflow_started:        { icon: Play,          label: "Workflow",          dot: "bg-violet-500"  },
  workflow_step:           { icon: StepForward,   label: "Workflow step",     dot: "bg-violet-300"  },
  extension_detected_page: { icon: Globe,         label: "Extension",         dot: "bg-emerald-500" },
  job_resolved:            { icon: Briefcase,     label: "Job resolved",      dot: "bg-emerald-400" },
  autofill_detected:       { icon: Zap,           label: "Autofill",          dot: "bg-yellow-400"  },
  autofill_reviewed:       { icon: CheckSquare,   label: "Autofill reviewed", dot: "bg-yellow-500"  },
  permission_prompt:       { icon: Shield,        label: "Permission",        dot: "bg-amber-500"   },
  research_started:        { icon: Search,        label: "Research",          dot: "bg-[#FF5C18]"   },
  research_finding:        { icon: Lightbulb,     label: "Finding",           dot: "bg-orange-400"  },
  manual_submit:           { icon: Briefcase,     label: "Manual submit",     dot: "bg-teal-500"    },
  browser_action:          { icon: Zap,           label: "Browser action",    dot: "bg-[#FF5C18]"   },
  error:                   { icon: AlertCircle,   label: "Error",             dot: "bg-red-500"     },
}

const FILTER_LABELS: Record<TimelineFilter, string> = {
  all:          "All",
  workflows:    "Workflows",
  autofill:     "Autofill",
  research:     "Research",
  applications: "Applications",
  extension:    "Browser",
  errors:       "Errors",
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "Unknown time"
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
}

function formatDay(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "Unknown day"
  return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })
}

function getSessionId(event: ScoutTimelineEvent): string {
  const value = event.metadata?.sessionId
  return typeof value === "string" && value.trim() ? value : "session-unknown"
}

function shortSessionLabel(sessionId: string, index: number): string {
  if (sessionId === "session-unknown") return `Session ${index + 1}`
  return `Session ${sessionId.slice(-4)}`
}

type EventRowProps = {
  event: ScoutTimelineEvent
  onReplay: (action: ScoutTimelineReplayAction) => void
  isDev: boolean
}

function EventRow({ event, onReplay, isDev }: EventRowProps) {
  const [expanded, setExpanded] = useState(false)
  const meta = EVENT_META[event.type]
  const isError = event.severity === "error"
  const isWarning = event.severity === "warning"

  return (
    <div
      className={cn(
        "rounded-lg border px-2.5 py-2 transition-colors",
        isError
          ? "border-red-100 bg-red-50/70"
          : isWarning
          ? "border-amber-100 bg-amber-50/70"
          : "border-transparent bg-white hover:border-slate-100 hover:bg-slate-50/70",
      )}
    >
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 flex items-center gap-1.5 flex-shrink-0">
          <span className={cn("h-2 w-2 rounded-full", meta.dot)} />
          <meta.icon className="h-3 w-3 text-slate-400" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                {meta.label} · {formatTime(event.timestamp)}
              </p>
              <p className={cn("text-[12.5px] font-medium leading-snug", isError ? "text-red-700" : "text-slate-800")}>
                {event.title}
              </p>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              {event.replayable && event.replayAction && (
                <button
                  type="button"
                  title="Replay"
                  onClick={() => onReplay(event.replayAction!)}
                  className="flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                >
                  <ArrowUpLeft className="h-3 w-3" />
                </button>
              )}
              {(event.summary || (isDev && event.metadata)) && (
                <button
                  type="button"
                  onClick={() => setExpanded((v) => !v)}
                  className="flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                >
                  {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                </button>
              )}
            </div>
          </div>

          {event.summary && (
            <p className={cn("mt-0.5 text-[11px] text-slate-500", !expanded && "line-clamp-1")}>
              {event.summary}
            </p>
          )}

          {expanded && isDev && event.metadata && (
            <pre className="mt-1.5 overflow-x-auto rounded bg-slate-100 p-2 text-[10px] text-slate-500">
              {JSON.stringify(event.metadata, null, 2)}
            </pre>
          )}
        </div>
      </div>
    </div>
  )
}

type GroupedDay = {
  dayKey: string
  events: ScoutTimelineEvent[]
}

type GroupedSession = {
  sessionId: string
  events: ScoutTimelineEvent[]
}

function groupByDay(events: ScoutTimelineEvent[]): GroupedDay[] {
  const map = new Map<string, ScoutTimelineEvent[]>()
  for (const e of events) {
    const key = formatDay(e.timestamp)
    const bucket = map.get(key) ?? []
    bucket.push(e)
    map.set(key, bucket)
  }
  return [...map.entries()].map(([dayKey, rows]) => ({ dayKey, events: rows }))
}

function groupBySession(events: ScoutTimelineEvent[]): GroupedSession[] {
  const map = new Map<string, ScoutTimelineEvent[]>()
  for (const e of events) {
    const sessionId = getSessionId(e)
    const bucket = map.get(sessionId) ?? []
    bucket.push(e)
    map.set(sessionId, bucket)
  }
  return [...map.entries()].map(([sessionId, rows]) => ({ sessionId, events: rows }))
}

type Props = {
  events: ScoutTimelineEvent[]
  onClose: () => void
  onReplay: (action: ScoutTimelineReplayAction) => void
  onClear: () => void
  isDev: boolean
}

export function ScoutTimelinePanel({ events, onClose, onReplay, onClear, isDev }: Props) {
  const [filter, setFilter] = useState<TimelineFilter>("all")

  const visible = useMemo(() => {
    const allowed = FILTER_EVENT_TYPES[filter]
    const filtered = allowed.length === 0
      ? events
      : events.filter((e) => allowed.includes(e.type))
    return filtered.slice(0, 120)
  }, [events, filter])

  const groupedDays = useMemo(() => groupByDay(visible), [visible])
  const errorCount = events.filter((e) => e.type === "error").length

  return (
    <div className="flex w-72 flex-shrink-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm xl:w-80">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <div className="flex items-center gap-2">
          <Clock className="h-3.5 w-3.5 text-slate-400" />
          <p className="text-sm font-semibold text-slate-900">Scout Activity</p>
          {events.length > 0 && (
            <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
              {events.length}
            </span>
          )}
          {errorCount > 0 && (
            <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-600">
              {errorCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {events.length > 0 && (
            <button
              type="button"
              onClick={onClear}
              title="Clear timeline"
              className="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-slate-100 px-3 py-2 scrollbar-none">
        {(Object.keys(FILTER_LABELS) as TimelineFilter[]).map((f) => {
          const count = f === "all"
            ? events.length
            : events.filter((e) => FILTER_EVENT_TYPES[f].includes(e.type)).length
          if (f !== "all" && count === 0) return null
          return (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={cn(
                "flex-shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold transition",
                filter === f
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700",
              )}
            >
              {FILTER_LABELS[f]}{count > 0 ? ` ${count}` : ""}
            </button>
          )
        })}
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        {visible.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-slate-400">
            <Clock className="h-5 w-5" />
            <p className="text-[11px]">
              {filter === "all" ? "No activity yet this session" : `No ${FILTER_LABELS[filter].toLowerCase()} events`}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {groupedDays.map((day) => (
              <div key={day.dayKey} className="space-y-2">
                <p className="px-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{day.dayKey}</p>
                <div className="space-y-2 border-l border-slate-200/80 pl-2">
                  {groupBySession(day.events).map((session, index) => (
                    <div key={`${day.dayKey}-${session.sessionId}`} className="space-y-1.5">
                      <p className="text-[10px] text-slate-300">{shortSessionLabel(session.sessionId, index)}</p>
                      {session.events.map((event) => (
                        <EventRow key={event.id} event={event} onReplay={onReplay} isDev={isDev} />
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {isDev && (
        <div className="border-t border-slate-100 px-4 py-2">
          <p className="text-[10px] text-slate-300">DEV · metadata + traces enabled</p>
        </div>
      )}
    </div>
  )
}
