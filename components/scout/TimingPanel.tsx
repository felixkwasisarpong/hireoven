"use client"

import { useEffect } from "react"
import type { TimingRecommendation } from "@/lib/scout/timing/timing-engine"
import type { ApplicationQueueItem } from "@/lib/scout/timing/queue-manager"

// ── Types ─────────────────────────────────────────────────────────────────────

export type HeatmapCell = {
  dayOfWeek: number
  dayLabel: string
  hour: number
  hourLabel: string
  screenRate: number
  label: string
}

export type TimingPanelData = {
  timingRecommendation: TimingRecommendation
  timingReason: string
  optimalApplyAt: string | null
  screenRateMultiplier: number
  hoursSincePosted: number
  postedAt: string | null
  heatmapData: HeatmapCell[]
  atsType?: string | null
  jobTitle?: string
  matchScore?: number | null
}

type Props = {
  data: TimingPanelData
  queue?: ApplicationQueueItem[]
  queueLoading?: boolean
  onApplyNow: () => void
  onSchedule?: (isoTime: string) => void
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const VERDICT_CONFIG: Record<
  TimingRecommendation,
  { label: string; subText: string; color: string; bg: string; borderColor: string }
> = {
  apply_now:        { label: "Apply now",   subText: "Optimal window",          color: "#1D9E75", bg: "#F0FBF7", borderColor: "#9FE1CB" },
  schedule_today:   { label: "Schedule",    subText: "Apply today",             color: "#D97706", bg: "#FFFBEB", borderColor: "#FDE68A" },
  schedule_tomorrow:{ label: "Schedule",    subText: "Best time is tomorrow",   color: "#D97706", bg: "#FFFBEB", borderColor: "#FDE68A" },
  low_priority:     { label: "Low priority",subText: "Posting is aging",        color: "#EF4444", bg: "#FFF5F5", borderColor: "#FCA5A5" },
}

function formatOptimalTime(iso: string | null): string {
  if (!iso) return "—"
  const d = new Date(iso)
  return d.toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
}

function formatHoursPosted(hours: number): string {
  if (hours >= 9999) return "Unknown"
  if (hours < 1)  return "Just posted"
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function cellBg(screenRate: number): string {
  if (screenRate >= 0.15) return "#1D9E75"
  if (screenRate >= 0.10) return "#9FE1CB"
  if (screenRate >= 0.07) return "#FAEEDA"
  return "var(--color-bg-secondary, #F8FAFC)"
}

function cellTextColor(screenRate: number): string {
  if (screenRate >= 0.15) return "#FFFFFF"
  if (screenRate >= 0.10) return "#0F4C36"
  return "var(--color-text-secondary, #64748B)"
}

function isCurrentSlot(cell: HeatmapCell): boolean {
  const now = new Date()
  return now.getDay() === cell.dayOfWeek && now.getHours() >= cell.hour && now.getHours() < cell.hour + 3
}

// ── Queue item icon ───────────────────────────────────────────────────────────

function QueueIcon({ status }: { status: ApplicationQueueItem["status"] }) {
  if (status === "ready") {
    return (
      <span className="material-icons" style={{ fontSize: 18, color: "#1D9E75" }}>
        play_circle
      </span>
    )
  }
  if (status === "scheduled") {
    return (
      <span className="material-icons" style={{ fontSize: 18, color: "#D97706" }}>
        schedule
      </span>
    )
  }
  return (
    <span className="material-icons" style={{ fontSize: 18, color: "#94A3B8" }}>
      hourglass_empty
    </span>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function TimingPanel({ data, queue, queueLoading, onApplyNow, onSchedule }: Props) {
  const verdict = VERDICT_CONFIG[data.timingRecommendation]

  // Inject Material Icons stylesheet once
  useEffect(() => {
    if (typeof document === "undefined") return
    if (document.querySelector('link[href*="Material+Icons"]')) return
    const link = document.createElement("link")
    link.rel = "stylesheet"
    link.href = "https://fonts.googleapis.com/icon?family=Material+Icons"
    document.head.appendChild(link)
  }, [])

  // Build unique hour labels for heatmap rows
  const hourLabels = Array.from(new Set(data.heatmapData.map((c) => c.hourLabel)))
  const dayLabels  = Array.from(new Set(data.heatmapData.map((c) => c.dayLabel)))

  return (
    <div className="w-full bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">

      {/* ── VERDICT ROW ────────────────────────────────────────────────────── */}
      <div
        className="px-5 py-4 flex items-start justify-between gap-4 border-b"
        style={{ borderColor: verdict.borderColor, background: verdict.bg }}
      >
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-500 mb-0.5">
            Smart application timing
          </p>
          {data.jobTitle && (
            <p className="text-[13px] font-semibold text-slate-900 leading-snug truncate">
              {data.jobTitle}
            </p>
          )}
          <p className="text-[11px] text-slate-500 mt-0.5">
            Posted {formatHoursPosted(data.hoursSincePosted)}
            {data.atsType ? ` · ${data.atsType} detected` : ""}
          </p>
        </div>
        <div className="flex-shrink-0 text-right">
          <p className="text-[15px] font-bold" style={{ color: verdict.color }}>
            {verdict.label}
          </p>
          <p className="text-[11px] font-medium" style={{ color: verdict.color }}>
            {verdict.subText}
          </p>
        </div>
      </div>

      {/* ── TLDR LINE ──────────────────────────────────────────────────────── */}
      <div className="px-5 py-3 border-b border-slate-100 text-[12px] text-slate-700 leading-relaxed">
        {data.timingReason}
      </div>

      {/* ── STATS ROW ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-4 divide-x divide-slate-100 border-b border-slate-100">
        {[
          { label: "Post age",        value: formatHoursPosted(data.hoursSincePosted) },
          { label: "Screen rate boost", value: `${data.screenRateMultiplier}×` },
          { label: "Best window",     value: formatOptimalTime(data.optimalApplyAt) },
          { label: "Match",           value: data.matchScore != null ? `${data.matchScore}%` : "—" },
        ].map(({ label, value }) => (
          <div key={label} className="px-3 py-3 text-center">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400 mb-0.5">
              {label}
            </p>
            <p className="text-[13px] font-bold text-slate-800 truncate">{value}</p>
          </div>
        ))}
      </div>

      {/* ── HEATMAP ────────────────────────────────────────────────────────── */}
      <div className="px-5 py-4 border-b border-slate-100">
        <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-400 mb-3">
          Best times to apply · Screen rate by day and hour
        </p>

        {/* Column headers */}
        <div className="grid gap-1" style={{ gridTemplateColumns: `80px repeat(${dayLabels.length}, 1fr)` }}>
          <div />
          {dayLabels.map((d) => (
            <div key={d} className="text-center text-[10px] font-semibold text-slate-500 pb-1">
              {d}
            </div>
          ))}

          {/* Rows */}
          {hourLabels.map((hourLabel) => (
            <>
              <div key={`lbl-${hourLabel}`} className="text-[10px] text-slate-400 flex items-center pr-2 leading-tight">
                {hourLabel}
              </div>
              {dayLabels.map((dayLabel) => {
                const cell = data.heatmapData.find(
                  (c) => c.dayLabel === dayLabel && c.hourLabel === hourLabel,
                )
                const rate = cell?.screenRate ?? 0.04
                const isCurrent = cell ? isCurrentSlot(cell) : false
                return (
                  <div
                    key={`${dayLabel}-${hourLabel}`}
                    title={`${(rate * 100).toFixed(1)}% screen rate`}
                    className="rounded-md h-8 flex items-center justify-center text-[10px] font-semibold transition-transform hover:scale-105"
                    style={{
                      background: cellBg(rate),
                      color: cellTextColor(rate),
                      outline: isCurrent ? `2px solid #1D9E75` : undefined,
                      outlineOffset: isCurrent ? "1px" : undefined,
                    }}
                  >
                    {(rate * 100).toFixed(0)}%
                  </div>
                )
              })}
            </>
          ))}
        </div>

        {/* Legend */}
        <div className="mt-3 flex items-center gap-3 flex-wrap">
          {[
            { label: "Best",    bg: "#1D9E75", text: "#FFFFFF" },
            { label: "Good",    bg: "#9FE1CB", text: "#0F4C36" },
            { label: "Average", bg: "#FAEEDA", text: "#78350F" },
            { label: "Low",     bg: "#F1F5F9", text: "#64748B" },
          ].map(({ label, bg, text }) => (
            <div key={label} className="flex items-center gap-1.5">
              <div
                className="h-3 w-3 rounded-sm"
                style={{ background: bg, border: "1px solid rgba(0,0,0,0.08)" }}
              />
              <span className="text-[10px] text-slate-500">{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── QUEUE SECTION ──────────────────────────────────────────────────── */}
      {(queue || queueLoading) && (
        <div className="px-5 py-4 border-b border-slate-100">
          <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-400 mb-3">
            Your application queue · Timing optimised
          </p>

          {queueLoading && (
            <p className="text-[12px] text-slate-500">Loading queue…</p>
          )}

          {!queueLoading && queue && queue.length === 0 && (
            <p className="text-[12px] text-slate-500">No saved jobs in your queue yet.</p>
          )}

          {!queueLoading && queue && queue.length > 0 && (
            <div className="space-y-2">
              {queue.slice(0, 6).map((item) => (
                <div key={item.jobId} className="flex items-center gap-2.5 py-1">
                  <QueueIcon status={item.status} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] font-semibold text-slate-800 truncate">
                      {item.jobTitle}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {item.companyName}
                      {item.hoursPosted < 9999 ? ` · ${formatHoursPosted(item.hoursPosted)}` : ""}
                      {item.matchScore != null ? ` · ${item.matchScore}% match` : ""}
                      {item.atsType ? ` · ${item.atsType}` : ""}
                    </p>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    {item.status === "ready" ? (
                      <span className="text-[11px] font-semibold" style={{ color: "#1D9E75" }}>
                        Apply now
                      </span>
                    ) : (
                      <span className="text-[11px] font-medium text-amber-600">
                        {item.optimalApplyAt ? formatOptimalTime(item.optimalApplyAt) : "Schedule"}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── CTA ROW ────────────────────────────────────────────────────────── */}
      <div className="px-5 py-4 flex items-center justify-between gap-3 flex-wrap">
        <p className="text-[10px] text-slate-400 flex-1 min-w-0">
          Screen-rate data from Hireoven application outcomes · updates as your applications get responses
        </p>
        <div className="flex items-center gap-2 flex-shrink-0">
          {data.timingRecommendation !== "apply_now" && data.optimalApplyAt && onSchedule && (
            <button
              type="button"
              onClick={() => onSchedule(data.optimalApplyAt!)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              Schedule
            </button>
          )}
          <button
            type="button"
            onClick={onApplyNow}
            className="rounded-lg px-3 py-1.5 text-[12px] font-semibold text-white transition"
            style={{ background: "#1D9E75" }}
          >
            Apply now
          </button>
        </div>
      </div>

    </div>
  )
}
