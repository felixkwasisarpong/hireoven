"use client"

import { AlertCircle, ArrowUpRight, Bell, Clock3, EyeOff, TrendingUp, X } from "lucide-react"
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

type Severity = ScoutProactiveEvent["severity"]

type Tone = {
  border:    string
  bg:        string
  ring:      string
  dot:       string
  iconText:  string
  iconRing:  string
  iconBg:    string
  accent:    string
  ctaBg:     string
  ctaHover:  string
  shadow:    string
  Icon:      typeof Bell
  kicker:    string
}

const TONE: Record<Severity, Tone> = {
  urgent: {
    border:    "border-rose-200/70",
    bg:        "bg-gradient-to-br from-white via-rose-50/40 to-rose-50/60",
    ring:      "ring-rose-100",
    dot:       "bg-rose-500",
    iconText:  "text-rose-600",
    iconRing:  "ring-rose-100",
    iconBg:    "bg-rose-50",
    accent:    "from-rose-400 via-rose-500 to-rose-400",
    ctaBg:     "bg-rose-600",
    ctaHover:  "hover:bg-rose-700",
    shadow:    "shadow-[0_2px_18px_rgba(244,63,94,0.10)]",
    Icon:      AlertCircle,
    kicker:    "text-rose-700",
  },
  important: {
    border:    "border-amber-200/70",
    bg:        "bg-gradient-to-br from-white via-amber-50/30 to-amber-50/60",
    ring:      "ring-amber-100",
    dot:       "bg-amber-500",
    iconText:  "text-amber-600",
    iconRing:  "ring-amber-100",
    iconBg:    "bg-amber-50",
    accent:    "from-amber-400 via-orange-400 to-amber-400",
    ctaBg:     "bg-slate-900",
    ctaHover:  "hover:bg-slate-800",
    shadow:    "shadow-[0_2px_18px_rgba(245,158,11,0.10)]",
    Icon:      TrendingUp,
    kicker:    "text-amber-700",
  },
  info: {
    border:    "border-slate-200/80",
    bg:        "bg-gradient-to-br from-white via-slate-50/40 to-slate-50/60",
    ring:      "ring-slate-100",
    dot:       "bg-sky-400",
    iconText:  "text-sky-600",
    iconRing:  "ring-sky-100",
    iconBg:    "bg-sky-50",
    accent:    "from-sky-300 via-sky-400 to-sky-300",
    ctaBg:     "bg-slate-900",
    ctaHover:  "hover:bg-slate-800",
    shadow:    "shadow-[0_2px_14px_rgba(15,23,42,0.06)]",
    Icon:      Bell,
    kicker:    "text-sky-700",
  },
}

const KICKER_LABEL: Record<Severity, string> = {
  urgent:    "Needs your attention",
  important: "Scout suggestion",
  info:      "Heads up",
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

  const tone = TONE[event.severity]
  const Icon = tone.Icon
  const kicker = KICKER_LABEL[event.severity]

  return (
    <article
      role="status"
      aria-live="polite"
      className={cn(
        "group relative mb-4 overflow-hidden rounded-2xl border backdrop-blur transition-all motion-safe:animate-[scoutFadeUp_0.45s_ease-out_both]",
        tone.border,
        tone.bg,
        tone.shadow
      )}
    >
      {/* Top accent bar */}
      <span
        aria-hidden
        className={cn("absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r", tone.accent)}
      />

      {/* Dismiss */}
      <button
        type="button"
        onClick={() => onDismiss(event.id)}
        aria-label="Dismiss"
        className="absolute right-2.5 top-2.5 inline-flex h-6 w-6 items-center justify-center rounded-md text-slate-300 transition hover:bg-white/80 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300/60"
      >
        <X className="h-3.5 w-3.5" />
      </button>

      <div className="flex items-start gap-3.5 p-4 sm:gap-4 sm:p-5">
        {/* Icon medallion */}
        <div
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1",
            tone.iconBg,
            tone.iconRing
          )}
        >
          <Icon className={cn("h-[18px] w-[18px]", tone.iconText)} aria-hidden />
        </div>

        {/* Body */}
        <div className="min-w-0 flex-1 pr-6">
          <p
            className={cn(
              "inline-flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.16em]",
              tone.kicker
            )}
          >
            <span className={cn("h-1.5 w-1.5 rounded-full", tone.dot)} />
            {kicker}
          </p>
          <h3 className="mt-1 text-[14px] font-semibold leading-snug text-slate-900">
            {event.title}
          </h3>
          {event.summary && (
            <p className="mt-1 text-[12.5px] leading-relaxed text-slate-500">
              {event.summary}
            </p>
          )}

          {/* Actions */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onOpen(event)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold text-white shadow-[0_2px_8px_rgba(15,23,42,0.18)] transition",
                tone.ctaBg,
                tone.ctaHover
              )}
            >
              Open suggestion
              <ArrowUpRight className="h-3.5 w-3.5" />
            </button>

            <button
              type="button"
              onClick={() => onSnooze(event.id)}
              className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-slate-500 transition hover:bg-white/70 hover:text-slate-800"
            >
              <Clock3 className="h-3 w-3" />
              Snooze
            </button>

            <button
              type="button"
              onClick={onDisable}
              className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-slate-400 transition hover:bg-white/70 hover:text-slate-700"
            >
              <EyeOff className="h-3 w-3" />
              Mute proactive
            </button>
          </div>
        </div>
      </div>
    </article>
  )
}
