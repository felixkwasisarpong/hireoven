"use client"

import { cn } from "@/lib/utils"

function formatTime(sec: number) {
  const m = Math.floor(Math.max(0, sec) / 60)
  const s = Math.max(0, sec) % 60
  return `${m}:${String(s).padStart(2, "0")}`
}

type Props = {
  remainingSec: number
}

export default function SessionTimer({ remainingSec }: Props) {
  const isWarning = remainingSec <= 120 && remainingSec > 0
  const isExpired = remainingSec <= 0

  return (
    <span
      className={cn(
        "tabular-nums text-[13px] font-semibold transition-colors",
        isExpired
          ? "text-red-500"
          : isWarning
            ? "animate-pulse text-orange-500"
            : "text-slate-600"
      )}
    >
      {formatTime(remainingSec)}
    </span>
  )
}
