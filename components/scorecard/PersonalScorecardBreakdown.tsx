import Link from "next/link"
import { TrendingUp, Gem, User, GraduationCap, Info, type LucideIcon } from "lucide-react"
import type { PersonalScorecard } from "@/lib/scorecard/personal-scorecard"
import { paletteFor } from "@/lib/scorecard/hue-palette"

function Row({
  icon: Icon,
  label,
  score,
  evidence,
  tileBg,
  iconClass,
  bar,
}: {
  icon: LucideIcon
  label: string
  score: number
  evidence: string
  tileBg: string
  iconClass: string
  bar: string
}) {
  const pct = Math.round((score / 25) * 100)
  return (
    <div className="flex gap-4 py-5">
      <div
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl"
        style={{ background: tileBg }}
      >
        <Icon className={`h-5 w-5 ${iconClass}`} strokeWidth={1.75} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[15px] font-semibold text-slate-900">{label}</span>
          <span className="shrink-0 text-sm font-bold tabular-nums text-slate-900">{score}/25</span>
        </div>
        <p className="mt-0.5 text-sm leading-relaxed text-slate-500">{evidence}</p>
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div className={`h-full rounded-full ${bar}`} style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  )
}

export function PersonalScorecardBreakdown({ card }: { card: PersonalScorecard }) {
  const c = card.result.components
  const p = paletteFor(card.result.bucket.hue)
  const alignmentText =
    c.experience.alignment === "fit"
      ? "Your experience aligns with your stated seniority."
      : c.experience.alignment === "above"
        ? "You bring more experience than your level typically requires — a credibility signal."
        : "You're early for your stated level; experience will compound this over time."

  return (
    <section className="mt-6 rounded-2xl border border-slate-200/70 bg-white p-6 shadow-[0_1px_3px_rgba(16,24,40,0.06)] sm:p-7">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-bold uppercase tracking-[0.12em] text-slate-700">
          How your score breaks down
        </h2>
        <Link
          href="/h1b-sponsors/leaderboard/methodology#personal-scorecard"
          className={`text-sm font-medium ${p.text} hover:underline`}
        >
          How we calculate this →
        </Link>
      </div>

      <div className="mt-3 divide-y divide-slate-100">
        <Row
          icon={TrendingUp}
          label="Skills demand"
          score={c.demand.score}
          tileBg={p.soft}
          iconClass={p.text}
          bar={p.bar}
          evidence={`${c.demand.matched_postings.toLocaleString()} sponsor postings in the last 12 months want your skills.`}
        />
        <Row
          icon={Gem}
          label="Skills rarity"
          score={c.rarity.score}
          tileBg={p.soft}
          iconClass={p.text}
          bar={p.bar}
          evidence={
            c.rarity.rarest_skill
              ? `Your rarest in-demand skill: ${c.rarity.rarest_skill}.`
              : "Rarer, in-demand skills raise this — a niche edge."
          }
        />
        <Row
          icon={User}
          label="Experience fit"
          score={c.experience.score}
          tileBg={p.soft}
          iconClass={p.text}
          bar={p.bar}
          evidence={alignmentText}
        />
        <Row
          icon={GraduationCap}
          label="Education"
          score={c.education.score}
          tileBg={p.soft}
          iconClass={p.text}
          bar={p.bar}
          evidence="Models LCA approval patterns (advanced + STEM degrees, work authorization)."
        />
      </div>

      <div className="mt-5 flex gap-3 rounded-xl border border-slate-200/70 bg-[#f6f9fc] p-4">
        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-100">
          <Info className="h-3.5 w-3.5 text-blue-500" />
        </span>
        <p className="text-sm leading-relaxed text-slate-500">
          <span className="font-semibold text-slate-700">What this is —</span> a profile-vs-market fit
          signal, not a guarantee or a measure of your worth. It updates as you update your resume,
          and a &ldquo;Building Profile&rdquo; is never &ldquo;unsponsorable&rdquo; — the rarest
          profiles sometimes get the best offers.
        </p>
      </div>
    </section>
  )
}
