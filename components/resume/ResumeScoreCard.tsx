"use client"

import { useEffect, useMemo, useState } from "react"
import { buildResumeScoreBreakdown } from "@/lib/resume/scoring"
import { cn } from "@/lib/utils"
import type { Resume } from "@/types"

function getScoreLabel(score: number) {
  if (score >= 86) return "Excellent"
  if (score >= 71) return "Strong"
  if (score >= 51) return "Good"
  return "Needs work"
}

function getScoreTone(score: number) {
  if (score >= 71) {
    return {
      ring: "#10B981",
      text: "text-emerald-600",
      chip: "bg-emerald-50 text-emerald-700 border-emerald-200",
    }
  }

  if (score >= 41) {
    return {
      ring: "#F59E0B",
      text: "text-amber-600",
      chip: "bg-amber-50 text-amber-700 border-amber-200",
    }
  }

  return {
    ring: "#EF4444",
    text: "text-red-600",
    chip: "bg-red-50 text-red-700 border-red-200",
  }
}

export default function ResumeScoreCard({ resume }: { resume: Resume }) {
  const [animatedScore, setAnimatedScore] = useState(0)
  const score = resume.resume_score ?? 0
  const tone = getScoreTone(score)
  const breakdown = useMemo(() => buildResumeScoreBreakdown(resume), [resume])

  const tips = useMemo(() => {
    const nextTips: string[] = []

    if (breakdown.completeness < 20) nextTips.push("Add a stronger summary and make sure experience, education, and skills are all present.")
    if (breakdown.achievements < 15) nextTips.push("Add numbers to your impact, like revenue lifted, time saved, or projects shipped.")
    if (breakdown.skillsClarity < 14) nextTips.push("Tighten the skills section so your strongest technical skills are obvious at a glance.")
    if (breakdown.summaryQuality < 10) nextTips.push("Write a sharper 3-4 line summary that says what you do, your level, and your edge.")
    if (breakdown.contactInfo < 8) nextTips.push("Round out the header with location, LinkedIn, or portfolio links.")

    return nextTips.slice(0, 4)
  }, [breakdown])

  useEffect(() => {
    const timeout = window.setTimeout(() => setAnimatedScore(score), 80)
    return () => window.clearTimeout(timeout)
  }, [score])

  const breakdownItems = [
    ["Completeness", breakdown.completeness, 30],
    ["Achievements", breakdown.achievements, 25],
    ["Skills", breakdown.skillsClarity, 20],
    ["Summary", breakdown.summaryQuality, 15],
    ["Contact", breakdown.contactInfo, 10],
  ] as const

  return (
    <div className="border-0 bg-transparent p-0 shadow-none">
      <div className="flex items-center gap-4">
        <div
          className="relative flex h-20 w-20 shrink-0 items-center justify-center rounded-full"
          style={{
            background: `conic-gradient(${tone.ring} ${animatedScore}%, #E5E7EB 0%)`,
          }}
        >
          <div className="flex h-[66px] w-[66px] items-center justify-center rounded-full bg-white">
            <span className={cn("text-2xl font-semibold", tone.text)}>{score}</span>
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-400">
            Resume quality
          </p>
          <p className="mt-1 text-xl font-semibold text-gray-900">{getScoreLabel(score)}</p>
          <span className={cn("mt-2 inline-block rounded-sm border px-2.5 py-1 text-xs font-medium", tone.chip)}>
            {score >= 71 ? "Strong foundation" : score >= 41 ? "Room to improve" : "Needs work"}
          </span>
        </div>
      </div>

      <div className="mt-6 space-y-4">
        {breakdownItems.map(([label, value, total]) => {
          const pct = Math.round(((value as number) / (total as number)) * 100)
          return (
            <div key={label as string}>
              <div className="flex items-center justify-between gap-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">
                  {label}
                </p>
                <p className="text-sm font-semibold text-gray-900">
                  {value as number}
                  <span className="text-xs font-medium text-gray-400">/{total as number}</span>
                </p>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-200">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${pct}%`,
                    backgroundColor: tone.ring,
                  }}
                />
              </div>
            </div>
          )
        })}
      </div>

      {tips.length > 0 && (
        <div className="mt-6 border border-[#E8C4A8] bg-[#FFFBF7] px-4 py-4">
          <p className="text-sm font-semibold text-[#9A3412]">Improvement tips</p>
          <div className="mt-3 space-y-2 text-sm leading-6 text-gray-600">
            {tips.map((tip) => (
              <p key={tip}>{tip}</p>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
