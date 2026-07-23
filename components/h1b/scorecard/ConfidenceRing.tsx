import { scoreBucket } from "@/lib/h1b/scorecard"
import type { ScoreHue } from "@/types/h1b-scorecard"

const STROKE: Record<ScoreHue, string> = {
  emerald: "stroke-emerald-500",
  green: "stroke-green-500",
  blue: "stroke-sky-500",
  amber: "stroke-amber-500",
  orange: "stroke-orange-500",
  red: "stroke-red-500",
}

// Lightened per-hue text so each grade stays legible AND distinct on the dark
// terminal canvas (strokes stay saturated in STROKE above).
const TEXT: Record<ScoreHue, string> = {
  emerald: "text-emerald-300",
  green: "text-green-300",
  blue: "text-sky-300",
  amber: "text-amber-300",
  orange: "text-orange-300",
  red: "text-red-300",
}

const R = 52
const CIRC = 2 * Math.PI * R

// Circular sponsorship-confidence gauge. Pure SVG so it renders on the server —
// the arc length encodes the 0-100 score, coloured by its letter-grade hue.
export function ConfidenceRing({ score }: { score: number }) {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(score) ? score : 0))
  const b = scoreBucket(clamped)
  const offset = CIRC * (1 - clamped / 100)

  return (
    <div className="flex flex-col items-center">
      <div className="relative h-32 w-32">
        <svg viewBox="0 0 120 120" className="h-32 w-32 -rotate-90">
          <circle cx="60" cy="60" r={R} className="stroke-[rgba(120,200,160,0.14)]" strokeWidth="9" fill="none" />
          <circle
            cx="60"
            cy="60"
            r={R}
            className={STROKE[b.hue]}
            strokeWidth="9"
            fill="none"
            strokeLinecap="round"
            strokeDasharray={CIRC}
            strokeDashoffset={offset}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={"text-[28px] font-bold leading-none " + TEXT[b.hue]}>{b.grade}</span>
          <span className="mt-1 text-xs font-medium tabular-nums text-[#ccd6cf]/45">{clamped}/100</span>
        </div>
      </div>
      <p className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-[#ccd6cf]/45">
        Sponsorship confidence
      </p>
      <p className={"text-[13px] font-semibold " + TEXT[b.hue]}>{b.label}</p>
    </div>
  )
}
