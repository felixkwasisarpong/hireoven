"use client"

import {
  ArrowRight,
  BarChart2,
  Briefcase,
  FileText,
  Globe,
  MessageSquare,
  RefreshCw,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { activeMissions } from "@/lib/scout/missions/store"
import type { ScoutMission, ScoutMissionStatus, ScoutMissionType } from "@/lib/scout/missions/types"

// ── Icons + colours per mission type ─────────────────────────────────────────

const TYPE_META: Record<ScoutMissionType, { icon: React.ElementType; label: string }> = {
  applications:    { icon: Briefcase,    label: "Apply" },
  resume:          { icon: FileText,     label: "Resume" },
  compare:         { icon: BarChart2,    label: "Compare" },
  interview:       { icon: MessageSquare,label: "Interview" },
  market_research: { icon: Globe,        label: "Market" },
  follow_up:       { icon: RefreshCw,    label: "Follow up" },
}

const PRIORITY_DOT: Record<string, string> = {
  high:   "bg-[#FF5C18]",
  medium: "bg-amber-400",
  low:    "bg-slate-300",
}

// ── Single mission row ────────────────────────────────────────────────────────

function MissionRow({
  mission,
  onLaunch,
  onDismiss,
}: {
  mission:   ScoutMission
  onLaunch:  (query: string) => void
  onDismiss: (id: string) => void
}) {
  const meta  = TYPE_META[mission.type]
  const Icon  = meta.icon
  const query = mission.suggestedActions?.[0] ?? ""

  return (
    <div className="group flex items-start gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3.5 transition hover:border-[#FF5C18]/30 hover:shadow-[0_4px_16px_rgba(255,92,24,0.06)]">

      {/* Priority dot + icon */}
      <div className="mt-0.5 flex flex-shrink-0 flex-col items-center gap-1.5">
        <span className={cn("h-1.5 w-1.5 rounded-full", PRIORITY_DOT[mission.priority])} />
        <Icon className="h-3.5 w-3.5 text-slate-400" />
      </div>

      {/* Text */}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-gray-900 leading-5">{mission.title}</p>
        <p className="mt-0.5 text-xs leading-5 text-gray-400">{mission.summary}</p>
      </div>

      {/* Actions */}
      <div className="flex flex-shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        {query && (
          <button
            type="button"
            onClick={() => onLaunch(query)}
            title="Start this mission"
            className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 transition hover:border-slate-950 hover:bg-slate-950 hover:text-white"
          >
            Start
            <ArrowRight className="h-3 w-3" />
          </button>
        )}
        <button
          type="button"
          onClick={() => onDismiss(mission.id)}
          title="Dismiss mission"
          className="rounded-lg p-1.5 text-slate-300 transition hover:bg-slate-50 hover:text-slate-500"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  )
}

// ── Strip component ───────────────────────────────────────────────────────────

type Props = {
  missions:      ScoutMission[]
  momentumLine?: string
  onLaunch:      (query: string) => void
  onDismiss:     (missionId: string) => void
  onDisableAll:  () => void
}

export function ScoutMissionStrip({
  missions,
  momentumLine,
  onLaunch,
  onDismiss,
  onDisableAll,
}: Props) {
  const visible = activeMissions(missions)
  if (visible.length === 0 && !momentumLine) return null

  return (
    <div className="mb-7">

      {/* Section header */}
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gray-400">
          Today's focus
        </p>
        <button
          type="button"
          onClick={onDisableAll}
          className="text-[10px] text-gray-300 transition hover:text-gray-400"
          title="Hide daily focus"
        >
          Hide
        </button>
      </div>

      {/* Momentum line */}
      {momentumLine && (
        <p className="mb-3 text-[13px] leading-6 text-gray-500">{momentumLine}</p>
      )}

      {/* Mission rows */}
      {visible.length > 0 && (
        <div className="space-y-2">
          {visible.map((m) => (
            <MissionRow
              key={m.id}
              mission={m}
              onLaunch={onLaunch}
              onDismiss={onDismiss}
            />
          ))}
        </div>
      )}
    </div>
  )
}
