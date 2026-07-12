"use client"

import { useEffect, useMemo, useState } from "react"
import { Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"

type Slot = {
  startsAt: string
  busyness: "low" | "medium" | "high"
  available: boolean
  recommended: boolean
}

type SchedulePickerProps = {
  durationMin: number
  value: string | null
  onChange: (startsAt: string | null) => void
}

const DAYS_SHOWN = 7

const BUSYNESS_STYLES: Record<Slot["busyness"], { label: string; className: string }> = {
  low:    { label: "Quiet",    className: "bg-[#ecfdf5] text-[#0b7a52]" },
  medium: { label: "Moderate", className: "bg-[#fff7ed] text-[#c2530d]" },
  high:   { label: "Busy",     className: "bg-[#fef2f2] text-[#dc2626]" },
}

function localDateKey(date: Date) {
  // en-CA renders as YYYY-MM-DD in the browser's timezone.
  return date.toLocaleDateString("en-CA")
}

function dayLabel(date: Date, index: number) {
  if (index === 0) return "Today"
  if (index === 1) return "Tomorrow"
  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
}

function timeLabel(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
}

export default function SchedulePicker({ durationMin, value, onChange }: SchedulePickerProps) {
  const timeZone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    []
  )
  const days = useMemo(() => {
    const now = new Date()
    return Array.from({ length: DAYS_SHOWN }, (_, i) => {
      const d = new Date(now)
      d.setDate(now.getDate() + i)
      return d
    })
  }, [])

  const [dayKey, setDayKey] = useState(() => localDateKey(new Date()))
  const [slots, setSlots] = useState<Slot[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    const params = new URLSearchParams({
      date: dayKey,
      tz: timeZone,
      durationMin: String(durationMin),
    })
    fetch(`/api/interview/schedule/slots?${params}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return
        if (d.error) {
          setError(d.error)
          setSlots([])
        } else {
          setSlots(d.slots ?? [])
        }
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load time slots — try again")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [dayKey, timeZone, durationMin])

  // Clear a selection that no longer belongs to the visible day.
  useEffect(() => {
    if (value && !loading && !slots.some((s) => s.startsAt === value)) {
      onChange(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots, loading])

  const recommended = slots.filter((s) => s.recommended && s.available)

  return (
    <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
      {/* Day selector */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {days.map((day, i) => {
          const key = localDateKey(day)
          return (
            <button
              key={key}
              type="button"
              onClick={() => setDayKey(key)}
              className={cn(
                "shrink-0 rounded-lg border px-3 py-1.5 text-[12.5px] font-medium transition",
                dayKey === key
                  ? "border-orange-300 bg-orange-50 text-orange-700 ring-1 ring-orange-300"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
              )}
            >
              {dayLabel(day, i)}
            </button>
          )
        })}
      </div>

      {loading && <p className="text-[13px] text-slate-500">Finding quiet slots…</p>}
      {error && <p className="text-[13px] text-red-600">{error}</p>}
      {!loading && !error && slots.length === 0 && (
        <p className="text-[13px] text-slate-500">
          No slots left this day — try another day.
        </p>
      )}

      {/* Suggested (least busy) slots */}
      {!loading && recommended.length > 0 && (
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-slate-700">
            <Sparkles className="h-3.5 w-3.5 text-orange-500" aria-hidden />
            Suggested — quietest times
          </p>
          <div className="flex flex-wrap gap-2">
            {recommended.map((slot) => (
              <button
                key={`rec-${slot.startsAt}`}
                type="button"
                onClick={() => onChange(slot.startsAt)}
                className={cn(
                  "rounded-lg border px-3 py-1.5 text-[13px] font-semibold transition",
                  value === slot.startsAt
                    ? "border-orange-400 bg-orange-500 text-white"
                    : "border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-100"
                )}
              >
                {timeLabel(slot.startsAt)}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* All slots */}
      {!loading && slots.length > 0 && (
        <div>
          <p className="mb-2 text-[12px] font-semibold text-slate-700">All times</p>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {slots.map((slot) => {
              const busy = BUSYNESS_STYLES[slot.busyness]
              return (
                <button
                  key={slot.startsAt}
                  type="button"
                  disabled={!slot.available}
                  onClick={() => onChange(slot.startsAt)}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-lg border px-2 py-2 transition",
                    value === slot.startsAt
                      ? "border-orange-400 bg-orange-50 ring-1 ring-orange-300"
                      : "border-slate-200 bg-white hover:border-slate-300",
                    !slot.available && "cursor-not-allowed opacity-40"
                  )}
                >
                  <span className="text-[13px] font-semibold text-slate-800">
                    {timeLabel(slot.startsAt)}
                  </span>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                      busy.className
                    )}
                  >
                    {slot.available ? busy.label : "Full"}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      <p className="text-[11.5px] text-slate-400">
        Times shown in your timezone ({timeZone}). Quiet slots start faster and run smoother.
      </p>
    </div>
  )
}
