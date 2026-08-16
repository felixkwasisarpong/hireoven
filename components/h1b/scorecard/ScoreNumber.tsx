import { scoreBucket } from "@/lib/h1b/scorecard"
import { cn } from "@/lib/utils"
import type { ScoreHue } from "@/types/h1b-scorecard"

// Per-hue grade text. These were -300 tints for the old dark terminal canvas;
// on the current white surface those ran 1.4-1.9:1. The -700 step keeps the six
// grades distinguishable while clearing AA on white (4.99-6.47:1).
const HUE_TEXT: Record<ScoreHue, string> = {
  emerald: "text-emerald-700",
  green: "text-green-700",
  lime: "text-lime-700",
  amber: "text-amber-700",
  orange: "text-orange-700",
  red: "text-red-700",
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
          <span className="text-lg font-semibold text-[var(--term-dim)]">/100</span>
        </div>
        <div className="text-lg font-semibold text-[var(--term-fg)]">{b.label}</div>
      </div>
    </div>
  )
}
