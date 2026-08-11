/**
 * Feed intelligence cards.
 *
 * The job feed isn't just a list — it's where we can surface the platform's
 * career intelligence at the moment of browsing. This builds a prioritized set
 * of grounded, actionable "insight cards" to weave into the feed between job
 * cards: a pivot toward an adjacent field with more openings, a nudge to sharpen
 * a split résumé signal, or an ask to affirm in-demand skills that would lift
 * the user's matches.
 *
 * Every card is corpus-grounded (real field demand + the résumé's real skill
 * overlap) and honest — nothing is invented. The list is empty when there's
 * nothing genuinely useful to say (no résumé, no corpus, no reachable upside),
 * so the feed shows only job cards.
 *
 * Server-only (reads field profiles). Pure given (resume, profiles).
 */

import {
  scoreResumeAgainstProfiles,
  detectResumeSignal,
  isSoftSkill,
  type FieldProfile,
} from "@/lib/resume/signal"
import { suggestPivotTarget, type PivotSuggestion } from "@/lib/resume/pivot-suggest"

export type InsightCard =
  | { type: "pivot"; id: string; priority: number; pivot: PivotSuggestion }
  | {
      type: "sharpen"
      id: string
      priority: number
      primaryKey: string
      primaryLabel: string
      runnerUpKey: string
      runnerUpLabel: string
    }
  | {
      type: "skill_boost"
      id: string
      priority: number
      fieldKey: string
      fieldLabel: string
      /** In-demand skills of the user's field the résumé doesn't yet show. */
      skills: string[]
    }

type ResumeInput = Parameters<typeof detectResumeSignal>[0]

// How many in-demand skills to offer in the skill-boost card.
const SKILL_BOOST_COUNT = 6

/**
 * Build the ordered insight cards for a résumé. Higher `priority` shows first
 * (and is interleaved earlier in the feed). Returns [] when there's nothing
 * grounded and useful to surface.
 */
export function buildFeedInsights(
  resume: ResumeInput | null | undefined,
  profiles: FieldProfile[] | null | undefined,
): InsightCard[] {
  if (!resume) return []
  // Every card is corpus-grounded (real field demand + the résumé's real skill
  // overlap). Without the corpus profiles there's nothing honest to say, so the
  // feed shows only jobs. (detectResumeSignal is imported for the type only.)
  if (!profiles || profiles.length === 0) return []
  const signal = scoreResumeAgainstProfiles(resume, profiles)

  const cards: InsightCard[] = []

  // 1. Pivot — the single best adjacent field with real upside. Highest value
  //    when present, so it leads.
  const pivot = suggestPivotTarget(signal, profiles)
  if (pivot) {
    cards.push({ type: "pivot", id: `pivot:${pivot.fromKey}->${pivot.toKey}`, priority: 100, pivot })
  }

  // 2. Skill boost — real in-demand skills of the user's strongest field that
  //    their résumé doesn't surface. Affirming them lifts matches immediately.
  const primary = signal.primary
  if (primary) {
    const skills = primary.missing.filter((s) => !isSoftSkill(s)).slice(0, SKILL_BOOST_COUNT)
    if (skills.length >= 3) {
      cards.push({
        type: "skill_boost",
        id: `skill_boost:${primary.key}`,
        priority: 80,
        fieldKey: primary.key,
        fieldLabel: primary.label,
        skills,
      })
    }
  }

  // 3. Sharpen — a split/ambiguous signal means the résumé reads across two
  //    lanes and scores lower in both. Tell them to pick one.
  if (signal.split && signal.primary && signal.runnerUp) {
    cards.push({
      type: "sharpen",
      id: `sharpen:${signal.primary.key}+${signal.runnerUp.key}`,
      priority: 60,
      primaryKey: signal.primary.key,
      primaryLabel: signal.primary.label,
      runnerUpKey: signal.runnerUp.key,
      runnerUpLabel: signal.runnerUp.label,
    })
  }

  return cards.sort((a, b) => b.priority - a.priority)
}
