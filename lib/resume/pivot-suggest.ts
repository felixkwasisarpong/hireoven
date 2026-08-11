/**
 * Auto-select the single best career pivot to surface to a user.
 *
 * The bridge intelligence in ./bridge.ts answers "how do I get from X to Y" once
 * a target is chosen. This picks the Y — the one adjacent field that is worth
 * nudging the user toward — so the feed can surface it without the user having
 * to know to visit /dashboard/pivot and hand-pick a target.
 *
 * Grounded and honest. Every number comes from the live corpus (field job counts
 * + sponsorship density) and the resume's real skill overlap; nothing is invented.
 * When no adjacent field meaningfully beats the user's current lane, it returns
 * null and the feed shows nothing — a pivot nudge only appears when there is a
 * real, reachable upside.
 *
 * Pure: takes the already-computed signal + profiles, does no I/O.
 */

import type { FieldProfile, ResumeSignal } from "@/lib/resume/signal"

export interface PivotSuggestion {
  fromKey: string
  fromLabel: string
  toKey: string
  toLabel: string
  /** Resume's current corpus-grounded fit for the target field, 0–100. */
  currentFit: number
  /** Live US openings in the user's current (strongest) field. */
  currentJobCount: number
  /** Live US openings in the target field. */
  targetJobCount: number
  /** targetJobCount / currentJobCount, rounded to 1 decimal (≥ 0). */
  jobMultiple: number
  /** 0–1 sponsorship density of the current field, when known. */
  currentSponsorship?: number
  /** 0–1 sponsorship density of the target field, when known. */
  targetSponsorship?: number
  /** Target − current sponsorship, in percentage points (int; may be negative). */
  sponsorDelta: number
  /** Up to 3 of the target field's most in-demand skills the resume lacks. */
  bridgeSkills: string[]
  /** What makes this pivot worth surfacing. */
  driver: "demand" | "sponsorship" | "both"
}

// A pivot only surfaces when the upside is real and the field is reachable.
const MIN_PRIMARY_FIT = 35 // resume must send a clear enough signal to reason from
// Corpus-grounded fit scores are compressed — a focused resume tops out around
// 40–55, a generalist lower — so "credibly adjacent" is judged RELATIVE to the
// user's own strongest field, not on an absolute scale.
const ADJ_REL = 0.7 // target fit must be ≥ 70% of the primary field's fit
const ADJ_FLOOR = 22 // ...but never below this, so a weak primary can't drag it down
const MIN_JOB_MULTIPLE = 1.25 // demand-driven pivot needs meaningfully more openings
const MIN_SPONSOR_DELTA_PTS = 8 // sponsorship-driven pivot needs a real visa edge
const MIN_TARGET_JOBS = 2000 // don't steer anyone into a thin field
const MIN_SHRINK_GUARD = 0.5 // never send someone to a field <half the size for sponsorship alone

// Generic JD boilerplate that leaks into the corpus skill lists. Never present
// these as a "skill to add to cross over" — they're noise, not a bridge.
const SOFT_SKILL_STOPWORDS = new Set([
  "communication",
  "leadership",
  "teamwork",
  "collaboration",
  "problem solving",
  "problem-solving",
  "time management",
  "recruiting",
  "mentoring",
  "mentorship",
  "interpersonal",
  "organization",
  "adaptability",
  "creativity",
  "critical thinking",
  "attention to detail",
  "work ethic",
  "self-motivated",
  "detail oriented",
  "detail-oriented",
])

function round1(x: number): number {
  return Math.round(x * 10) / 10
}

/**
 * Pick the best pivot target for a resume, or null if the current lane is
 * already the right one. `signal` must be corpus-grounded (from
 * scoreResumeAgainstProfiles) so `fields[*].missing` carries real bridge skills.
 */
export function suggestPivotTarget(
  signal: ResumeSignal | null | undefined,
  profiles: FieldProfile[] | null | undefined,
): PivotSuggestion | null {
  const primary = signal?.primary
  if (!primary || primary.score < MIN_PRIMARY_FIT) return null
  if (!profiles || profiles.length === 0) return null

  const jobCountByKey = new Map(profiles.map((p) => [p.key, p.jobCount]))
  const currentJobCount = jobCountByKey.get(primary.key) ?? 0
  // Adjacency bar, relative to how strong the user's own strongest read is.
  const minTargetFit = Math.max(ADJ_FLOOR, primary.score * ADJ_REL)

  type Scored = { s: PivotSuggestion; rank: number }
  let best: Scored | null = null

  for (const field of signal!.fields) {
    if (field.key === primary.key) continue
    // Fields are sorted by fit desc, so the target is always ≤ primary; it just
    // has to be close enough to be a credible next step.
    if (field.score < minTargetFit) continue

    const targetJobCount = jobCountByKey.get(field.key) ?? 0
    if (targetJobCount < MIN_TARGET_JOBS) continue

    // Real technical skills the resume lacks — never JD boilerplate.
    const bridgeSkills = field.missing
      .filter((s) => !SOFT_SKILL_STOPWORDS.has(s.toLowerCase().trim()))
      .slice(0, 3)
    if (bridgeSkills.length === 0) continue // nothing concrete to cross with

    const jobMultiple = currentJobCount > 0 ? targetJobCount / currentJobCount : 0
    const curSpon = primary.sponsorshipShare
    const tgtSpon = field.sponsorshipShare
    const sponsorDelta =
      typeof curSpon === "number" && typeof tgtSpon === "number"
        ? Math.round((tgtSpon - curSpon) * 100)
        : 0

    const demandWorthy = jobMultiple >= MIN_JOB_MULTIPLE
    const sponsorWorthy =
      sponsorDelta >= MIN_SPONSOR_DELTA_PTS &&
      targetJobCount >= currentJobCount * MIN_SHRINK_GUARD
    if (!demandWorthy && !sponsorWorthy) continue

    // Never surface a strictly-worse move (fewer jobs AND no visa upside).
    if (targetJobCount < currentJobCount && sponsorDelta < MIN_SPONSOR_DELTA_PTS) continue

    const driver: PivotSuggestion["driver"] =
      demandWorthy && sponsorWorthy ? "both" : demandWorthy ? "demand" : "sponsorship"

    // Rank: reward more openings, a bigger visa edge, and how close they already
    // are (a shorter bridge is a better nudge).
    const rank =
      Math.max(0, jobMultiple - 1) * 1.0 +
      Math.max(0, sponsorDelta) / 100 * 1.5 +
      (field.score / 100) * 0.5

    const suggestion: PivotSuggestion = {
      fromKey: primary.key,
      fromLabel: primary.label,
      toKey: field.key,
      toLabel: field.label,
      currentFit: field.score,
      currentJobCount,
      targetJobCount,
      jobMultiple: round1(jobMultiple),
      currentSponsorship: curSpon,
      targetSponsorship: tgtSpon,
      sponsorDelta,
      bridgeSkills,
      driver,
    }
    if (!best || rank > best.rank) best = { s: suggestion, rank }
  }

  return best?.s ?? null
}
