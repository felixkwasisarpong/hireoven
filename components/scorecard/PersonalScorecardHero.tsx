import { cn } from "@/lib/utils"
import type { PersonalScorecard } from "@/lib/scorecard/personal-scorecard"
import type { ScoreHue } from "@/types/h1b-scorecard"

const HUE_TEXT: Record<ScoreHue, string> = {
  emerald: "text-emerald-600",
  green: "text-green-600",
  blue: "text-blue-600",
  amber: "text-amber-600",
  orange: "text-orange-600",
  red: "text-red-500",
}

function qualifier(score: number): string {
  if (score >= 22) return "exceptional"
  if (score >= 18) return "strong"
  if (score >= 14) return "solid"
  if (score >= 10) return "developing"
  return "emerging"
}

// Page framing (decision 1c): lead with the strongest component, then the number,
// then the letter as the SMALLEST element. The letter is loud on the share image, quiet here.
export function PersonalScorecardHero({ card }: { card: PersonalScorecard }) {
  const { result } = card
  const hue = HUE_TEXT[result.bucket.hue]
  return (
    <header className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
      <p className="text-sm font-medium text-slate-500">Your sponsorability profile</p>
      <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
        Your {result.strongest.label.toLowerCase()} is{" "}
        <span className={hue}>{qualifier(result.strongest.score)}</span>.
      </h1>
      <div className="mt-5 flex items-end gap-4">
        <div className={cn("text-5xl font-black tabular-nums", hue)}>
          {card.total_score}
          <span className="text-2xl font-semibold text-slate-400">/100</span>
        </div>
        <span
          className={cn(
            "mb-1 inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset",
            "bg-slate-50 ring-slate-200 text-slate-600"
          )}
        >
          {result.bucket.grade} · {result.bucket.label}
        </span>
      </div>
    </header>
  )
}
