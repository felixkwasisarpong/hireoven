import { scoreBucket } from "@/lib/h1b/scorecard"
import { cn } from "@/lib/utils"
import type { ScoreHue } from "@/types/h1b-scorecard"

// Light-theme hue classes (the public /h1b-sponsors pages render on a light background).
const HUE_CLASSES: Record<ScoreHue, string> = {
  emerald: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  green: "bg-green-50 text-green-700 ring-green-200",
  blue: "bg-blue-50 text-blue-700 ring-blue-200",
  amber: "bg-amber-50 text-amber-700 ring-amber-200",
  orange: "bg-orange-50 text-orange-700 ring-orange-200",
  red: "bg-red-50 text-red-600 ring-red-200",
}

// Small inline grade badge — reusable on leaderboard rows and the company profile.
export function ScorecardBadge({ score, className }: { score: number; className?: string }) {
  const b = scoreBucket(score)
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset",
        HUE_CLASSES[b.hue],
        className
      )}
      title={b.label}
    >
      <span>{b.grade}</span>
      <span className="opacity-60">{score}</span>
    </span>
  )
}
