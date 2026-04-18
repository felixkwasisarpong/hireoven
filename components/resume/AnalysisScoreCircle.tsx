"use client"

import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"

type Size = "sm" | "md" | "lg"

type Props = {
  score: number
  size?: Size
  animated?: boolean
}

const SIZES: Record<Size, { svg: number; stroke: number; textClass: string }> = {
  sm: { svg: 64,  stroke: 6,  textClass: "text-lg font-semibold" },
  md: { svg: 96,  stroke: 8,  textClass: "text-2xl font-semibold" },
  lg: { svg: 140, stroke: 10, textClass: "text-4xl font-bold" },
}

function scoreColor(score: number) {
  if (score >= 70) return { stroke: "#10B981", text: "text-emerald-600" }
  if (score >= 40) return { stroke: "#F59E0B", text: "text-amber-500" }
  return { stroke: "#EF4444", text: "text-red-500" }
}

export default function AnalysisScoreCircle({ score, size = "md", animated = true }: Props) {
  const [displayed, setDisplayed] = useState(animated ? 0 : score)
  const { svg, stroke, textClass } = SIZES[size]
  const color = scoreColor(score)

  const radius = (svg - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (displayed / 100) * circumference

  useEffect(() => {
    if (!animated) {
      setDisplayed(score)
      return
    }
    const timeout = window.setTimeout(() => setDisplayed(score), 120)
    return () => window.clearTimeout(timeout)
  }, [score, animated])

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: svg, height: svg }}>
      <svg width={svg} height={svg} className="-rotate-90">
        <circle
          cx={svg / 2}
          cy={svg / 2}
          r={radius}
          fill="none"
          stroke="#E5E7EB"
          strokeWidth={stroke}
        />
        <circle
          cx={svg / 2}
          cy={svg / 2}
          r={radius}
          fill="none"
          stroke={color.stroke}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: animated ? "stroke-dashoffset 1.5s cubic-bezier(0.4,0,0.2,1)" : "none" }}
        />
      </svg>
      <span className={cn("absolute", textClass, color.text)}>{Math.round(displayed)}</span>
    </div>
  )
}
