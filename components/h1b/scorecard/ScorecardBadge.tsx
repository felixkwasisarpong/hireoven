import { scoreBucket } from "@/lib/h1b/scorecard"
import { cn } from "@/lib/utils"
import type { ScoreHue } from "@/types/h1b-scorecard"

// Every surface this badge renders on is light, so there is a single hue set.
// (There used to be a parallel dark map for the leaderboard panel; that panel is
// no longer dark, and its -300 text ran ~1.5:1 once the canvas turned white.)
const HUE_CLASSES: Record<ScoreHue, string> = {
  emerald: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  green: "bg-green-50 text-green-700 ring-green-200",
  lime: "bg-lime-50 text-lime-700 ring-lime-200",
  amber: "bg-amber-50 text-amber-700 ring-amber-200",
  orange: "bg-orange-50 text-orange-700 ring-orange-200",
  red: "bg-red-50 text-red-700 ring-red-200",
}

// Small inline grade badge — reusable on leaderboard rows and the company profile.
export function ScorecardBadge({
  score,
  className,
}: {
  score: number
  className?: string
}) {
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
      {/* De-emphasised by weight, not opacity: opacity-60 composited the hue
          down to 2.4-3.0:1 against the badge tint. */}
      <span className="font-medium">{score}</span>
    </span>
  )
}
