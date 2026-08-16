import { scoreBucket } from "@/lib/h1b/scorecard"
import type { ScoreHue } from "@/types/h1b-scorecard"

const STROKE: Record<ScoreHue, string> = {
  emerald: "stroke-emerald-600",
  green: "stroke-green-600",
  lime: "stroke-lime-600",
  amber: "stroke-amber-600",
  orange: "stroke-orange-600",
  red: "stroke-red-600",
}

// Per-hue grade text, AA on the white surface these gauges now render on.
// (Was a -300 tint tuned for the retired dark terminal canvas.)
const TEXT: Record<ScoreHue, string> = {
  emerald: "text-emerald-700",
  green: "text-green-700",
  lime: "text-lime-700",
  amber: "text-amber-700",
  orange: "text-orange-700",
  red: "text-red-700",
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
          <circle cx="60" cy="60" r={R} className="stroke-[var(--term-line-strong)]" strokeWidth="9" fill="none" />
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
          <span className="mt-1 text-xs font-medium tabular-nums text-[var(--term-dim)]">{clamped}/100</span>
        </div>
      </div>
      <p className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-[var(--term-dim)]">
        Sponsorship confidence
      </p>
      <p className={"text-[13px] font-semibold " + TEXT[b.hue]}>{b.label}</p>
    </div>
  )
}
