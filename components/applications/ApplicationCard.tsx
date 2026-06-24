"use client"

import { useDraggable } from "@dnd-kit/core"
import {
  ArrowRight,
  Banknote,
  Bell,
  CalendarClock,
  Clock,
  Hourglass,
  Pencil,
  Sparkles,
  Users,
} from "lucide-react"
import CompanyLogo from "@/components/ui/CompanyLogo"
import { cn } from "@/lib/utils"
import { salaryShort, daysInStage, nextAction, deriveTags, type NextActionIcon } from "@/lib/applications/card-meta"
import type { JobApplication } from "@/types"

function scoreColor(score: number) {
  if (score >= 70) return "border-emerald-200 bg-emerald-50 text-emerald-700"
  if (score >= 40) return "border-amber-200 bg-amber-50 text-amber-700"
  return "border-red-200 bg-red-50 text-red-700"
}

const ACTION_ICON: Record<NextActionIcon, typeof Bell> = {
  calendar: CalendarClock,
  bell: Bell,
  hourglass: Hourglass,
}
const ACTION_TONE: Record<"due" | "warn" | "neutral", string> = {
  due: "bg-red-50 text-red-600",
  warn: "bg-amber-50 text-amber-700",
  neutral: "bg-slate-100 text-slate-600",
}

type Props = {
  application: JobApplication
  onOpen: () => void
  /** Disable drag (mobile uses tap + quick-advance instead). Default true. */
  draggable?: boolean
  /** When provided, shows a hover quick-advance button to the next stage. */
  onAdvance?: () => void
  advanceLabel?: string
}

export function ApplicationCard({ application, onOpen, draggable = true, onAdvance, advanceLabel }: Props) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: application.id,
    disabled: !draggable,
  })

  const salary = salaryShort(application)
  const days = daysInStage(application)
  const action = nextAction(application)
  const tags = deriveTags(application)
  const rounds = application.interviews?.length ?? 0
  const ActionIcon = action ? ACTION_ICON[action.icon] : null

  const dragProps = draggable ? { ...attributes, ...listeners } : {}

  return (
    <div
      ref={setNodeRef}
      style={transform ? { transform: `translate3d(${transform.x}px,${transform.y}px,0)` } : undefined}
      {...dragProps}
      onClick={onOpen}
      className={cn(
        "group relative select-none rounded-[14px] border border-slate-200/80 bg-white p-3.5",
        "shadow-[0_1px_0_rgba(15,23,42,0.04),0_4px_12px_rgba(15,23,42,0.04)]",
        "transition-shadow hover:border-slate-300 hover:shadow-[0_8px_24px_rgba(15,23,42,0.09)]",
        draggable ? (isDragging ? "cursor-grabbing opacity-40" : "cursor-grab") : "cursor-pointer"
      )}
    >
      {/* Header */}
      <div className="flex items-start gap-2.5">
        <CompanyLogo
          companyName={application.company_name}
          domain={application.company_domain ?? undefined}
          logoUrl={application.company_logo_url}
          className="h-9 w-9 rounded-xl"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[10.5px] font-semibold uppercase tracking-[0.18em] text-slate-400">
            {application.company_name}
          </p>
          <p className="mt-0.5 truncate text-[13px] font-semibold leading-snug text-slate-900">
            {application.job_title}
          </p>
        </div>
        {application.match_score != null && (
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-0.5 rounded-full border px-2 py-0.5 text-[10.5px] font-semibold transition-opacity group-hover:opacity-0",
              scoreColor(application.match_score)
            )}
          >
            <Sparkles className="h-3 w-3" />
            {application.match_score}%
          </span>
        )}
      </div>

      {/* Meta: salary */}
      {salary && (
        <div className="mt-2.5 flex items-center gap-1.5 text-[12px] text-slate-500">
          <Banknote className="h-3.5 w-3.5 text-slate-400" />
          {salary}
        </div>
      )}

      {/* Footer chips */}
      {(days != null || action || rounds > 0) && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {days != null && (
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10.5px] font-medium text-slate-600">
              <Clock className="h-3 w-3" />
              {days}d
            </span>
          )}
          {action && ActionIcon && (
            <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold", ACTION_TONE[action.tone])}>
              <ActionIcon className="h-3 w-3" />
              {action.label}
            </span>
          )}
          {rounds > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10.5px] font-medium text-slate-600">
              <Users className="h-3 w-3" />
              {rounds}
            </span>
          )}
        </div>
      )}

      {/* Tags */}
      {tags.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <span key={t} className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium capitalize text-slate-500">
              {t}
            </span>
          ))}
        </div>
      )}

      {/* Hover quick actions */}
      <div className="absolute right-2.5 top-2.5 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        {onAdvance && (
          <button
            type="button"
            aria-label={advanceLabel ?? "Advance to next stage"}
            title={advanceLabel ?? "Advance"}
            onClick={(e) => { e.stopPropagation(); onAdvance() }}
            className="flex h-6 w-6 items-center justify-center rounded-[7px] border border-slate-200 bg-white text-slate-500 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700"
          >
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          type="button"
          aria-label="Open application"
          onClick={(e) => { e.stopPropagation(); onOpen() }}
          className="flex h-6 w-6 items-center justify-center rounded-[7px] border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 hover:text-slate-800"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}
