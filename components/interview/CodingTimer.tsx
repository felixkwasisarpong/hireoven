"use client"

import { cn } from "@/lib/utils"

function fmt(sec: number) {
  const m = Math.floor(Math.max(0, sec) / 60)
  const s = Math.max(0, sec) % 60
  return `${m}:${String(s).padStart(2, "0")}`
}

type Props = {
  remainingSec: number
  targetSec: number
}

export default function CodingTimer({ remainingSec, targetSec }: Props) {
  const pct = targetSec > 0 ? remainingSec / targetSec : 1
  const isWarning = pct <= 0.2 && remainingSec > 0
  const isExpired = remainingSec <= 0

  return (
    <span
      className={cn(
        "tabular-nums text-[13px] font-semibold transition-colors",
        isExpired ? "text-red-500" : isWarning ? "animate-pulse text-orange-500" : "text-slate-600"
      )}
    >
      {fmt(remainingSec)}
    </span>
  )
}
