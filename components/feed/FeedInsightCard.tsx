"use client"

import { useState } from "react"
import Link from "next/link"
import { GitBranch, ArrowRight, Plane, X, Check, Plus, Compass, Sparkles } from "lucide-react"
import type { InsightCard } from "@/components/feed/useFeedInsights"

/**
 * Renders one interleaved feed intelligence card. A thin dispatcher over the
 * card union; each sub-card is grounded (see lib/feed/insights.ts) and self-
 * contained. Shares one visual language with the feed — a soft indigo/violet
 * "intelligence" card, distinct from job cards, dismissible.
 */
export default function FeedInsightCard({
  card,
  onDismiss,
  onAffirm,
}: {
  card: InsightCard
  onDismiss: (id: string) => void
  onAffirm: (skills: string[]) => void | Promise<void>
}) {
  return (
    <Shell onDismiss={() => onDismiss(card.id)}>
      {card.type === "pivot" && <PivotBody card={card} />}
      {card.type === "sharpen" && <SharpenBody card={card} />}
      {card.type === "skill_boost" && <SkillBoostBody card={card} onAffirm={onAffirm} />}
    </Shell>
  )
}

function Shell({ children, onDismiss }: { children: React.ReactNode; onDismiss: () => void }) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-indigo-200 bg-gradient-to-r from-indigo-50 via-violet-50 to-emerald-50 px-4 py-3">
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="absolute right-2 top-2 rounded-md p-1 text-slate-400 transition hover:bg-white/60 hover:text-slate-600"
      >
        <X className="h-3.5 w-3.5" aria-hidden />
      </button>
      {children}
    </div>
  )
}

function Icon({ children }: { children: React.ReactNode }) {
  return (
    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-indigo-600/10 text-indigo-600">
      {children}
    </span>
  )
}

function fmt(n: number): string {
  return n.toLocaleString("en-US")
}

function PivotBody({ card }: { card: Extract<InsightCard, { type: "pivot" }> }) {
  const p = card.pivot
  const showMultiple = p.jobMultiple >= 1.3 && p.currentJobCount > 0
  const showSponsor = p.sponsorDelta >= 8 && typeof p.targetSponsorship === "number"
  const bridge = p.bridgeSkills.slice(0, 3)
  return (
    <div className="flex items-start gap-3 pr-6">
      <Icon>
        <GitBranch className="h-4 w-4" aria-hidden />
      </Icon>
      <div className="min-w-0 space-y-1.5">
        <p className="text-[13px] leading-snug text-slate-700">
          You read strongest as <span className="font-semibold text-slate-900">{p.fromLabel}</span>, but{" "}
          <span className="font-semibold text-indigo-700">{p.toLabel}</span> is right next door —{" "}
          <span className="font-semibold text-slate-900">{fmt(p.targetJobCount)} live US openings</span>
          {showMultiple && <span className="text-slate-500"> ({p.jobMultiple}× your current field)</span>}
          {showSponsor && (
            <>
              {", "}
              <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
                <Plane className="h-3.5 w-3.5" aria-hidden />
                {Math.round((p.targetSponsorship as number) * 100)}% sponsor visas
              </span>{" "}
              <span className="text-emerald-600">(+{p.sponsorDelta} pts)</span>
            </>
          )}
          . You&rsquo;re already <span className="font-semibold text-slate-900">{p.currentFit}% of the way there</span>.
        </p>
        {bridge.length > 0 && (
          <p className="flex flex-wrap items-center gap-1.5 text-[12px] text-slate-600">
            <span className="text-slate-500">Cross over by adding:</span>
            {bridge.map((s) => (
              <span
                key={s}
                className="rounded-md bg-white/70 px-1.5 py-0.5 font-medium text-slate-700 ring-1 ring-inset ring-indigo-100"
              >
                {s}
              </span>
            ))}
          </p>
        )}
        <Link
          href={`/dashboard/pivot?to=${encodeURIComponent(p.toKey)}`}
          className="inline-flex items-center gap-1.5 pt-0.5 text-[12.5px] font-semibold text-indigo-700 transition hover:text-indigo-900"
        >
          See your {p.toLabel} pivot plan
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </div>
    </div>
  )
}

function SharpenBody({ card }: { card: Extract<InsightCard, { type: "sharpen" }> }) {
  return (
    <div className="flex items-start gap-3 pr-6">
      <Icon>
        <Compass className="h-4 w-4" aria-hidden />
      </Icon>
      <div className="min-w-0 space-y-1.5">
        <p className="text-[13px] leading-snug text-slate-700">
          Your résumé reads across two lanes —{" "}
          <span className="font-semibold text-slate-900">{card.primaryLabel}</span> and{" "}
          <span className="font-semibold text-slate-900">{card.runnerUpLabel}</span>. Picking one and sharpening
          toward it scores you higher in that field&rsquo;s matches (a split signal costs you in both).
        </p>
        <Link
          href="/dashboard/positioning"
          className="inline-flex items-center gap-1.5 pt-0.5 text-[12.5px] font-semibold text-indigo-700 transition hover:text-indigo-900"
        >
          Sharpen your positioning
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </div>
    </div>
  )
}

function SkillBoostBody({
  card,
  onAffirm,
}: {
  card: Extract<InsightCard, { type: "skill_boost" }>
  onAffirm: (skills: string[]) => void | Promise<void>
}) {
  const [affirmed, setAffirmed] = useState<Set<string>>(new Set())

  const toggle = (skill: string) => {
    if (affirmed.has(skill)) return
    setAffirmed((prev) => new Set(prev).add(skill))
    void onAffirm([skill])
  }

  return (
    <div className="flex items-start gap-3 pr-6">
      <Icon>
        <Sparkles className="h-4 w-4" aria-hidden />
      </Icon>
      <div className="min-w-0 space-y-2">
        <p className="text-[13px] leading-snug text-slate-700">
          <span className="font-semibold text-slate-900">{card.fieldLabel}</span> roles keep asking for these. Tap
          the ones you have — we&rsquo;ll fold them in and{" "}
          <span className="font-medium text-slate-900">sharpen your match scores</span>.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {card.skills.map((skill) => {
            const on = affirmed.has(skill)
            return (
              <button
                key={skill}
                type="button"
                onClick={() => toggle(skill)}
                disabled={on}
                className={
                  on
                    ? "inline-flex items-center gap-1 rounded-md bg-emerald-100 px-2 py-1 text-[12px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200"
                    : "inline-flex items-center gap-1 rounded-md bg-white/80 px-2 py-1 text-[12px] font-medium text-slate-700 ring-1 ring-inset ring-indigo-100 transition hover:bg-white hover:ring-indigo-300"
                }
              >
                {skill}
                {on ? <Check className="h-3 w-3" aria-hidden /> : <Plus className="h-3 w-3 text-slate-400" aria-hidden />}
              </button>
            )
          })}
        </div>
        {affirmed.size > 0 && (
          <p className="text-[11.5px] text-emerald-600">
            Added {affirmed.size} skill{affirmed.size > 1 ? "s" : ""} — your matches will re-score shortly.
          </p>
        )}
      </div>
    </div>
  )
}
