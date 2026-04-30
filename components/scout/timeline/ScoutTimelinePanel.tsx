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
  Layers,
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
import { useState } from "react"
import { cn } from "@/lib/utils"
import type {
  ScoutTimelineEvent,
  ScoutTimelineEventType,
  TimelineFilter,
  ScoutTimelineReplayAction,
} from "@/lib/scout/timeline/types"
import { FILTER_EVENT_TYPES } from "@/lib/scout/timeline/types"

// ── Event type → display metadata ─────────────────────────────────────────────

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
  manual_submit:           { icon: Layers,        label: "Submitted",         dot: "bg-teal-500"    },
  error:                   { icon: AlertCircle,   label: "Error",             dot: "bg-red-500"     },
}

// ── Relative timestamp ────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 1)  return "just now"
  if (diffMin < 60) return `${diffMin}m ago`
  const d = new Date(iso)
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
}

// ── Single event row ──────────────────────────────────────────────────────────

function EventRow({
  event,
  onReplay,
  isDev,
}: {
  event:    ScoutTimelineEvent
  onReplay: (action: ScoutTimelineReplayAction) => void
  isDev:    boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const meta  = EVENT_META[event.type]
  const Icon  = meta.icon
  const isErr = event.severity === "error"
  const isWarn = event.severity === "warning"

  return (
    <div className={cn(
      "group relative px-4 py-2.5 transition-colors",
      isErr  && "bg-red-50/60",
      isWarn && "bg-amber-50/40",
      !isErr && !isWarn && "hover:bg-slate-50/60",
    )}>
      <div className="flex items-start gap-3">
        {/* Timeline spine dot + icon */}
        <div className="flex flex-col items-center gap-1 flex-shrink-0 pt-0.5">
          <span className={cn("h-2 w-2 rounded-full flex-shrink-0", meta.dot)} />
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className={cn(
                  "text-[10px] font-semibold uppercase tracking-wider",
                  isErr ? "text-red-500" : isWarn ? "text-amber-600" : "text-slate-400",
                )}>
                  {meta.label}
                </span>
                <span className="text-[10px] text-slate-300">·</span>
                <span className="text-[10px] text-slate-400">{relativeTime(event.timestamp)}</span>
              </div>
              <p className={cn(
                "mt-0.5 text-[13px] font-medium leading-snug",
                isErr ? "text-red-700" : "text-slate-800",
              )}>
                {event.title}
              </p>
              {event.summary && !expanded && (
                <p className="mt-0.5 truncate text-[11px] text-slate-400">{event.summary}</p>
              )}
              {expanded && (
                <div className="mt-1.5 space-y-1">
                  {event.summary && (
                    <p className="text-[11px] text-slate-500 leading-relaxed">{event.summary}</p>
                  )}
                  {isDev && event.metadata && (
                    <pre className="mt-1 overflow-x-auto rounded bg-slate-100 p-2 text-[10px] text-slate-500">
                      {JSON.stringify(event.metadata, null, 2)}
                    </pre>
                  )}
                </div>
              )}
            </div>

            {/* Action buttons (replay + expand) */}
            <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
              {event.replayable && event.replayAction && (
                <button
                  type="button"
                  onClick={() => onReplay(event.replayAction!)}
                  title="Replay this action"
                  className="flex h-5 w-5 items-center justify-center rounded text-slate-400 transition hover:bg-slate-200 hover:text-slate-700"
                >
                  <ArrowUpLeft className="h-3 w-3" />
                </button>
              )}
              {(event.summary || (isDev && event.metadata)) && (
                <button
                  type="button"
                  onClick={() => setExpanded((v) => !v)}
                  className="flex h-5 w-5 items-center justify-center rounded text-slate-400 transition hover:bg-slate-200 hover:text-slate-700"
                >
                  {expanded
                    ? <ChevronUp   className="h-3 w-3" />
                    : <ChevronDown className="h-3 w-3" />}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Filter tabs ───────────────────────────────────────────────────────────────

const FILTER_LABELS: Record<TimelineFilter, string> = {
  all:       "All",
  workflows: "Workflows",
  research:  "Research",
  extension: "Extension",
  errors:    "Errors",
}

// ── Main panel ────────────────────────────────────────────────────────────────

type Props = {
  events:   ScoutTimelineEvent[]
  onClose:  () => void
  onReplay: (action: ScoutTimelineReplayAction) => void
  onClear:  () => void
  isDev:    boolean
}

export function ScoutTimelinePanel({ events, onClose, onReplay, onClear, isDev }: Props) {
  const [filter, setFilter] = useState<TimelineFilter>("all")

  const allowedTypes = FILTER_EVENT_TYPES[filter]
  const visible = (allowedTypes.length === 0
    ? events
    : events.filter((e) => (allowedTypes as ScoutTimelineEventType[]).includes(e.type))
  ).slice(0, 50)

  const errorCount = events.filter((e) => e.type === "error").length

  return (
    <div className="flex w-72 flex-shrink-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm xl:w-80">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <div className="flex items-center gap-2">
          <Clock className="h-3.5 w-3.5 text-slate-400" />
          <p className="text-sm font-semibold text-slate-900">Activity</p>
          {events.length > 0 && (
            <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
              {events.length}
            </span>
          )}
          {errorCount > 0 && (
            <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-600">
              {errorCount} error{errorCount !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {events.length > 0 && (
            <button
              type="button"
              onClick={onClear}
              title="Clear activity log"
              className="flex h-6 w-6 items-center justify-center rounded text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* ── Filter strip ────────────────────────────────────────────────────── */}
      <div className="flex gap-1 overflow-x-auto border-b border-slate-100 px-3 py-2 scrollbar-none">
        {(Object.keys(FILTER_LABELS) as TimelineFilter[]).map((f) => {
          const count = f === "all"
            ? events.length
            : events.filter((e) =>
                (FILTER_EVENT_TYPES[f] as ScoutTimelineEventType[]).includes(e.type)
              ).length
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
              {FILTER_LABELS[f]}
              {count > 0 && ` ${count}`}
            </button>
          )
        })}
      </div>

      {/* ── Event list ──────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto divide-y divide-slate-50">
        {visible.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-slate-400">
            <Clock className="h-5 w-5" />
            <p className="text-[11px]">
              {filter === "all" ? "No activity yet this session" : `No ${FILTER_LABELS[filter].toLowerCase()} events`}
            </p>
          </div>
        ) : (
          visible.map((event) => (
            <EventRow
              key={event.id}
              event={event}
              onReplay={onReplay}
              isDev={isDev}
            />
          ))
        )}
      </div>

      {/* ── Dev footer ──────────────────────────────────────────────────────── */}
      {isDev && (
        <div className="border-t border-slate-100 px-4 py-2">
          <p className="text-[10px] text-slate-300">DEV · {events.length} events in store · ↩ = replay</p>
        </div>
      )}
    </div>
  )
}
