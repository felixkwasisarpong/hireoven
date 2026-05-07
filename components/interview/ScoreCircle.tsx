"use client"

import { useEffect, useState } from "react"

const RADIUS = 40
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

function colorForScore(score: number): string {
  if (score >= 85) return "#16a34a" // green-600
  if (score >= 70) return "#10b981" // emerald-500
  if (score >= 55) return "#f59e0b" // amber-500
  if (score >= 40) return "#f97316" // orange-500
  return "#ef4444"                  // red-500
}

export default function ScoreCircle({ score }: { score: number }) {
  const [displayed, setDisplayed] = useState(0)
  const clamped = Math.min(100, Math.max(0, Math.round(score)))

  useEffect(() => {
    let start: number | null = null
    const duration = 1200
    function step(ts: number) {
      if (!start) start = ts
      const progress = Math.min((ts - start) / duration, 1)
      // easeOut cubic
      const eased = 1 - Math.pow(1 - progress, 3)
      setDisplayed(Math.round(eased * clamped))
      if (progress < 1) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }, [clamped])

  const offset = CIRCUMFERENCE * (1 - displayed / 100)
  const color = colorForScore(clamped)

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative" style={{ width: 100, height: 100 }}>
        <svg width={100} height={100} className="-rotate-90">
          {/* Track */}
          <circle
            cx={50} cy={50} r={RADIUS}
            fill="none"
            stroke="#e2e8f0"
            strokeWidth={8}
          />
          {/* Progress */}
          <circle
            cx={50} cy={50} r={RADIUS}
            fill="none"
            stroke={color}
            strokeWidth={8}
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={offset}
            style={{ transition: "stroke-dashoffset 0.05s linear" }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-3xl font-bold text-slate-900">{displayed}</span>
        </div>
      </div>
      <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">Overall score</span>
    </div>
  )
}
