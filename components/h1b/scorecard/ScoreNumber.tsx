import { scoreBucket } from "@/lib/h1b/scorecard"
import { cn } from "@/lib/utils"
import type { ScoreHue } from "@/types/h1b-scorecard"

// Lightened per-hue text so each grade stays legible AND distinct on the dark
// terminal canvas.
const HUE_TEXT: Record<ScoreHue, string> = {
  emerald: "text-emerald-300",
  green: "text-green-300",
  blue: "text-blue-300",
  amber: "text-amber-300",
  orange: "text-orange-300",
  red: "text-red-300",
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
          <span className="text-lg font-semibold text-[#ccd6cf]/45">/100</span>
        </div>
        <div className="text-lg font-semibold text-[#ccd6cf]">{b.label}</div>
      </div>
    </div>
  )
}
