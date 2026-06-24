import Link from "next/link"
import type { PersonalScorecard } from "@/lib/scorecard/personal-scorecard"

function Bar({ score }: { score: number }) {
  return (
    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
      <div
        className="h-full rounded-full bg-slate-400"
        style={{ width: `${Math.round((score / 25) * 100)}%` }}
      />
    </div>
  )
}

function Row({
  label,
  score,
  evidence,
}: {
  label: string
  score: number
  evidence: string
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-baseline justify-between">
        <span className="font-medium text-slate-900">{label}</span>
        <span className="text-sm tabular-nums text-slate-500">{score}/25</span>
      </div>
      <Bar score={score} />
      <p className="mt-2 text-sm text-slate-500">{evidence}</p>
    </div>
  )
}

export function PersonalScorecardBreakdown({ card }: { card: PersonalScorecard }) {
  const c = card.result.components
  const alignmentText =
    c.experience.alignment === "fit"
      ? "Your experience aligns with your stated seniority."
      : c.experience.alignment === "above"
        ? "You bring more experience than your level typically requires — a credibility signal."
        : "You're early for your stated level; experience will compound this over time."

  return (
    <section className="mt-6">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
        How your score breaks down
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <Row
          label="Skills demand"
          score={c.demand.score}
          evidence={`${c.demand.matched_postings.toLocaleString()} sponsor postings in the last 12 months want your skills.`}
        />
        <Row
          label="Skills rarity"
          score={c.rarity.score}
          evidence={
            c.rarity.rarest_skill
              ? `Your rarest in-demand skill: ${c.rarity.rarest_skill}.`
              : "Rarer, in-demand skills raise this — a niche edge."
          }
        />
        <Row label="Experience fit" score={c.experience.score} evidence={alignmentText} />
        <Row
          label="Education"
          score={c.education.score}
          evidence="Models LCA approval patterns (advanced + STEM degrees, work authorization)."
        />
      </div>

      <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50/60 p-5 text-sm text-slate-600">
        <p className="font-medium text-slate-700">What this score is — and isn&rsquo;t</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>It&rsquo;s a <strong>profile-vs-market fit</strong> signal, not a guarantee or a measure of your worth.</li>
          <li>It updates as you update your resume — it&rsquo;s a snapshot, not a verdict.</li>
          <li>
            A &ldquo;Building Profile&rdquo; isn&rsquo;t &ldquo;unsponsorable.&rdquo; Sometimes the rarest profiles get the best offers — the market is wide.
          </li>
        </ul>
        <p className="mt-3">
          <Link
            href="/h1b-sponsors/leaderboard/methodology#personal-scorecard"
            className="font-medium text-slate-800 underline hover:text-slate-900"
          >
            How we calculate this
          </Link>
        </p>
      </div>
    </section>
  )
}
