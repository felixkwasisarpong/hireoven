import type { PersonalScorecard } from "@/lib/scorecard/personal-scorecard"
import { paletteFor } from "@/lib/scorecard/hue-palette"

function qualifier(score: number): string {
  if (score >= 22) return "exceptional"
  if (score >= 18) return "strong"
  if (score >= 14) return "solid"
  if (score >= 10) return "developing"
  return "emerging"
}

// Circular score dial — grade in the center, arc fills to total_score/100 in the
// grade's hue.
function ScoreDial({ score, grade, ring, scoreClass }: { score: number; grade: string; ring: string; scoreClass: string }) {
  const r = 54
  const c = 2 * Math.PI * r
  const filled = Math.max(0, Math.min(1, score / 100)) * c
  return (
    <div className="relative h-[132px] w-[132px] shrink-0">
      <svg viewBox="0 0 132 132" className="h-full w-full -rotate-90">
        <circle cx="66" cy="66" r={r} fill="none" stroke="#edf1f5" strokeWidth="9" />
        <circle
          cx="66"
          cy="66"
          r={r}
          fill="none"
          stroke={ring}
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${c}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[2.4rem] font-bold leading-none tracking-tight text-slate-900">{grade}</span>
        <span className={`mt-1.5 text-sm font-semibold tabular-nums ${scoreClass}`}>{score}/100</span>
      </div>
    </div>
  )
}

export function PersonalScorecardHero({ card }: { card: PersonalScorecard }) {
  const { result } = card
  const p = paletteFor(result.bucket.hue)
  return (
    <header className="rounded-2xl border border-slate-200/70 bg-white p-6 shadow-[0_1px_3px_rgba(16,24,40,0.06)] sm:p-8">
      <div className="flex flex-col items-center gap-6 sm:flex-row sm:gap-9">
        <ScoreDial score={card.total_score} grade={result.bucket.grade} ring={p.ring} scoreClass={p.text} />
        <div className="min-w-0 text-center sm:text-left">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
            Your sponsorability profile
          </p>
          <h1 className="mt-2 font-serif text-[1.9rem] font-medium leading-tight tracking-tight text-slate-900 sm:text-[2.1rem]">
            Your {result.strongest.label.toLowerCase()} is{" "}
            <span className={p.text}>{qualifier(result.strongest.score)}</span>.
          </h1>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-3 sm:justify-start">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ${p.text}`}
              style={{ background: p.soft }}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: p.ring }} />
              {result.bucket.grade} · {result.bucket.label}
            </span>
            <span className="text-sm text-slate-400">H-1B sponsorability fit</span>
          </div>
        </div>
      </div>
    </header>
  )
}
