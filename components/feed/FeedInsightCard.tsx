"use client"

import { useState } from "react"
import Link from "next/link"
import { ArrowRight, X, Check, Plus } from "lucide-react"
import type { InsightCard } from "@/components/feed/useFeedInsights"

/**
 * Renders one interleaved feed intelligence card. Deliberately plain — no card chrome, just a small muted label and neutral text,
 * so it reads as a quiet, useful note in the feed rather than a boxed-in ad. A thin dispatcher over the card union; each sub-card
 * is grounded (see lib/feed/insights.ts) and dismissible.
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
    <Shell label={LABELS[card.type]} onDismiss={() => onDismiss(card.id)}>
      {card.type === "pivot" && <PivotBody card={card} />}
      {card.type === "sharpen" && <SharpenBody card={card} />}
      {card.type === "skill_boost" && <SkillBoostBody card={card} onAffirm={onAffirm} />}
    </Shell>
  )
}

const LABELS: Record<InsightCard["type"], string> = {
  pivot: "Career move",
  skill_boost: "Skills",
  sharpen: "Positioning",
}

function Shell({
  label,
  children,
  onDismiss,
}: {
  label: string
  children: React.ReactNode
  onDismiss: () => void
}) {
  // No card chrome — a plain block that sits in the feed flow, set apart only by
  // a small muted label and a little breathing room, not a bordered box.
  return (
    <div className="px-1 py-1.5">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</span>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="rounded p-0.5 text-slate-300 transition hover:text-slate-500"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
      {children}
    </div>
  )
}

function CardLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="mt-2 inline-flex items-center gap-1 text-[12.5px] font-medium text-slate-700 underline-offset-2 transition hover:text-slate-900 hover:underline"
    >
      {children}
      <ArrowRight className="h-3.5 w-3.5" aria-hidden />
    </Link>
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
    <div>
      <p className="text-[13px] leading-snug text-slate-600">
        You read strongest as <span className="font-medium text-slate-900">{p.fromLabel}</span>, but{" "}
        <span className="font-medium text-slate-900">{p.toLabel}</span> is closely adjacent —{" "}
        <span className="font-medium text-slate-900">{fmt(p.targetJobCount)} live US openings</span>
        {showMultiple && <span> ({p.jobMultiple}× your current field)</span>}
        {showSponsor && (
          <span>
            , {Math.round((p.targetSponsorship as number) * 100)}% sponsor visas (+{p.sponsorDelta} pts)
          </span>
        )}
        . You&rsquo;re already <span className="font-medium text-slate-900">{p.currentFit}% of the way there</span>.
      </p>
      {bridge.length > 0 && (
        <p className="mt-1 text-[12px] text-slate-500">Cross over by adding: {bridge.join(", ")}</p>
      )}
      <CardLink href={`/dashboard/pivot?to=${encodeURIComponent(p.toKey)}`}>
        See your {p.toLabel} pivot plan
      </CardLink>
    </div>
  )
}

function SharpenBody({ card }: { card: Extract<InsightCard, { type: "sharpen" }> }) {
  return (
    <div>
      <p className="text-[13px] leading-snug text-slate-600">
        Your résumé reads across two lanes — <span className="font-medium text-slate-900">{card.primaryLabel}</span>{" "}
        and <span className="font-medium text-slate-900">{card.runnerUpLabel}</span>. Picking one and sharpening
        toward it scores you higher in that field&rsquo;s matches; a split signal costs you in both.
      </p>
      <CardLink href="/dashboard/positioning">Sharpen your positioning</CardLink>
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
    <div>
      <p className="text-[13px] leading-snug text-slate-600">
        <span className="font-medium text-slate-900">{card.fieldLabel}</span> roles keep asking for these. Tap the
        ones you have — we&rsquo;ll add them and re-score your matches.
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
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
                  ? "inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-100 px-2 py-1 text-[12px] text-slate-500"
                  : "inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[12px] text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
              }
            >
              {skill}
              {on ? (
                <Check className="h-3 w-3 text-slate-400" aria-hidden />
              ) : (
                <Plus className="h-3 w-3 text-slate-400" aria-hidden />
              )}
            </button>
          )
        })}
      </div>
      {affirmed.size > 0 && (
        <p className="mt-1.5 text-[11.5px] text-slate-400">
          Added {affirmed.size} skill{affirmed.size > 1 ? "s" : ""} — matches will re-score shortly.
        </p>
      )}
    </div>
  )
}
