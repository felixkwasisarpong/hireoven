import { scoreBucket } from "@/lib/h1b/scorecard"
import { cn } from "@/lib/utils"
import type { ScoreHue } from "@/types/h1b-scorecard"

const HUE_TEXT: Record<ScoreHue, string> = {
  emerald: "text-emerald-600",
  green: "text-green-600",
  blue: "text-blue-600",
  amber: "text-amber-600",
  orange: "text-orange-600",
  red: "text-red-500",
}

// The big "A+ · 87/100 · Strong Sponsor" block used in the scorecard hero.
export function ScoreNumber({ score }: { score: number }) {
  const b = scoreBucket(score)
  const hue = HUE_TEXT[b.hue]
  return (
    <div className="flex items-end gap-5">
      <span className={cn("text-7xl font-black leading-none tracking-tight sm:text-8xl", hue)}>
        {b.grade}
      </span>
      <div className="pb-2">
        <div className={cn("text-3xl font-bold", hue)}>
          {score}
          <span className="text-lg font-semibold text-slate-400">/100</span>
        </div>
        <div className="text-lg font-semibold text-slate-700">{b.label}</div>
      </div>
    </div>
  )
}
