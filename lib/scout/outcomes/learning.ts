/**
 * Outcome Learning Engine — pure computation, no I/O.
 *
 * Derives learning signals from recorded application outcomes.
 * All signals are evidence-backed, cautiously phrased.
 * No inferences about protected traits. No fake causality.
 *
 * Tone rules (enforced in signal text):
 *   ✓ "appears to work better for"
 *   ✓ "based on recorded outcomes"
 *   ✓ "responses seem stronger when"
 *   ✗ "guaranteed"
 *   ✗ "caused"
 *   ✗ "always"
 */

import type {
  OutcomeLearningSignal,
  ApplicationFeedbackItem,
  OutcomeLearningResult,
  ApplicationOutcome,
} from "./types"
import { POSITIVE_OUTCOMES, TERMINAL_OUTCOMES } from "./types"

// ── Minimal application shape needed for learning ─────────────────────────────

export type LearningApplicationRow = {
  id:           string
  job_title:    string
  company_name: string
  status:       string
  apply_url?:   string | null
  is_remote?:   boolean
  match_score?: number | null
  source?:      string | null
  applied_at?:  string | null
  notes?:       string | null
  /** Inferred from the outcome note JSON if stored */
  outcome?:     ApplicationOutcome
}

// ── Helpers ───────────────────────────────────────────────────────────────────

type Bucket = {
  total:    number
  positive: number
}

function rate(bucket: Bucket): number {
  return bucket.total === 0 ? 0 : Math.round((bucket.positive / bucket.total) * 100)
}

function confidenceFromCount(n: number): OutcomeLearningSignal["confidence"] {
  if (n >= 8) return "high"
  if (n >= 3) return "medium"
  return "low"
}

function daysSince(iso: string | null | undefined): number {
  if (!iso) return 0
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
}

function inferOutcomeFromStatus(status: string): ApplicationOutcome | null {
  const map: Record<string, ApplicationOutcome> = {
    applied:      "applied",
    phone_screen: "recruiter_screen",
    interview:    "interview",
    final_round:  "interview",
    offer:        "offer",
    rejected:     "rejected",
    withdrawn:    "withdrawn",
  }
  return map[status] ?? null
}

function isPositiveOutcome(app: LearningApplicationRow): boolean {
  const outcome = app.outcome ?? inferOutcomeFromStatus(app.status) ?? null
  if (!outcome) return false
  return POSITIVE_OUTCOMES.has(outcome)
}

function isTerminal(app: LearningApplicationRow): boolean {
  const outcome = app.outcome ?? inferOutcomeFromStatus(app.status) ?? null
  if (!outcome) return false
  return TERMINAL_OUTCOMES.has(outcome)
}

// ── Signal generators ─────────────────────────────────────────────────────────

function remoteVsOnsiteSignal(apps: LearningApplicationRow[]): OutcomeLearningSignal | null {
  const terminal = apps.filter(isTerminal)
  if (terminal.length < 4) return null

  const remote = terminal.filter((a) => a.is_remote)
  const onsite = terminal.filter((a) => !a.is_remote)
  if (remote.length < 2 || onsite.length < 2) return null

  const remoteRate = rate({ total: remote.length, positive: remote.filter(isPositiveOutcome).length })
  const onsiteRate = rate({ total: onsite.length, positive: onsite.filter(isPositiveOutcome).length })
  const diff = remoteRate - onsiteRate

  if (Math.abs(diff) < 15) return null

  if (diff > 0) {
    return {
      id:        "remote-better",
      signal:    `Remote roles appear to generate stronger responses for your profile (${remoteRate}% vs ${onsiteRate}% for onsite).`,
      evidence:  [`${remote.filter(isPositiveOutcome).length} of ${remote.length} remote applications advanced`, `${onsite.filter(isPositiveOutcome).length} of ${onsite.length} onsite applications advanced`],
      confidence: confidenceFromCount(terminal.length),
      suggestedAction: "Prioritize remote roles in your next application batch",
      dimension:  "work_mode",
    }
  } else {
    return {
      id:        "onsite-better",
      signal:    `Onsite roles appear to generate stronger responses (${onsiteRate}% vs ${remoteRate}% for remote).`,
      evidence:  [`${onsite.filter(isPositiveOutcome).length} of ${onsite.length} onsite applications advanced`],
      confidence: confidenceFromCount(terminal.length),
      suggestedAction: "Consider including local onsite roles in your applications",
      dimension:  "work_mode",
    }
  }
}

function matchScoreSignal(apps: LearningApplicationRow[]): OutcomeLearningSignal | null {
  const withScores = apps.filter((a) => typeof a.match_score === "number" && isTerminal(a))
  if (withScores.length < 4) return null

  const highMatch = withScores.filter((a) => (a.match_score ?? 0) >= 75)
  const lowMatch  = withScores.filter((a) => (a.match_score ?? 0) <  75)
  if (highMatch.length < 2 || lowMatch.length < 2) return null

  const highRate = rate({ total: highMatch.length, positive: highMatch.filter(isPositiveOutcome).length })
  const lowRate  = rate({ total: lowMatch.length,  positive: lowMatch.filter(isPositiveOutcome).length  })

  if (highRate - lowRate < 15) return null

  return {
    id:        "high-match-better",
    signal:    `Based on recorded outcomes, applications with 75%+ match score appear to get ${highRate}% response vs ${lowRate}% for lower matches.`,
    evidence:  [`${highMatch.filter(isPositiveOutcome).length}/${highMatch.length} high-match applications advanced`, `${lowMatch.filter(isPositiveOutcome).length}/${lowMatch.length} lower-match applications advanced`],
    confidence: confidenceFromCount(withScores.length),
    suggestedAction: "Focus new applications on roles where Scout shows 75%+ match",
    dimension:  "general",
  }
}

function velocitySignal(apps: LearningApplicationRow[]): OutcomeLearningSignal | null {
  const last30 = apps.filter((a) => daysSince(a.applied_at) <= 30)
  const prev30 = apps.filter((a) => daysSince(a.applied_at) > 30 && daysSince(a.applied_at) <= 60)

  const recentPositive  = last30.filter(isPositiveOutcome).length
  const previousPositive = prev30.filter(isPositiveOutcome).length

  if (last30.length < 3 || prev30.length < 3) return null

  const recentRate  = rate({ total: last30.length,  positive: recentPositive })
  const previousRate = rate({ total: prev30.length, positive: previousPositive })
  const delta = recentRate - previousRate

  if (Math.abs(delta) < 10) return null

  if (delta > 0) {
    return {
      id:        "momentum-up",
      signal:    `Your application pace and outcomes appear stronger in the last 30 days (${recentRate}% response vs ${previousRate}% the month before). Keep the momentum going.`,
      evidence:  [`${recentPositive} of ${last30.length} recent applications advanced`],
      confidence: confidenceFromCount(last30.length),
      suggestedAction: "Maintain current application pace and role focus",
      dimension:  "general",
    }
  } else {
    return {
      id:        "momentum-down",
      signal:    `Responses appear softer in the last 30 days (${recentRate}% vs ${previousRate}% previously). This could reflect seasonal hiring patterns or a signal to adjust the role focus.`,
      evidence:  [`${recentPositive} of ${last30.length} recent applications advanced`],
      confidence: confidenceFromCount(last30.length),
      suggestedAction: "Review recent role targets — consider adjusting criteria or trying different company types",
      dimension:  "general",
    }
  }
}

function ghostingSignal(apps: LearningApplicationRow[]): OutcomeLearningSignal | null {
  const applied = apps.filter((a) => a.status === "applied" && daysSince(a.applied_at) > 21)
  if (applied.length < 3) return null

  const ghostCount = applied.length
  const totalApplied = apps.filter((a) => a.status !== "saved").length
  if (totalApplied < 5) return null

  const ghostRate = Math.round((ghostCount / totalApplied) * 100)
  if (ghostRate < 40) return null

  return {
    id:        "high-ghost-rate",
    signal:    `${ghostRate}% of your applications haven't received any response after 3+ weeks. This is common but worth tracking — it may indicate role targeting or timing adjustments could help.`,
    evidence:  [`${ghostCount} applications over 21 days old with no status update`],
    confidence: confidenceFromCount(ghostCount),
    suggestedAction: "Focus on roles posted within the last 14 days and companies with recent hiring activity",
    dimension:  "general",
  }
}

// ── Feedback needed ───────────────────────────────────────────────────────────

function findFeedbackNeeded(apps: LearningApplicationRow[]): ApplicationFeedbackItem[] {
  return apps
    .filter((a) => a.status === "applied" && daysSince(a.applied_at) >= 14 && daysSince(a.applied_at) < 60)
    .slice(0, 5)
    .map((a) => ({
      applicationId:    a.id,
      jobTitle:         a.job_title,
      companyName:      a.company_name,
      appliedAt:        a.applied_at ?? new Date().toISOString(),
      daysSinceApplied: daysSince(a.applied_at),
      currentStatus:    a.status,
    }))
}

// ── Stats ─────────────────────────────────────────────────────────────────────

function computeStats(apps: LearningApplicationRow[]) {
  const applied   = apps.filter((a) => a.status !== "saved")
  const responded = applied.filter((a) => {
    const outcome = inferOutcomeFromStatus(a.status)
    return outcome && POSITIVE_OUTCOMES.has(outcome)
  })
  const interviewed = applied.filter((a) => ["interview", "final_round", "offer"].includes(a.status))
  const offered     = applied.filter((a) => a.status === "offer")

  return {
    totalApplications: applied.length,
    responded:         responded.length,
    responseRate:      applied.length > 0 ? Math.round((responded.length / applied.length) * 100) : 0,
    interviewRate:     applied.length > 0 ? Math.round((interviewed.length / applied.length) * 100) : 0,
    offerRate:         applied.length > 0 ? Math.round((offered.length / applied.length) * 100) : 0,
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

export function computeOutcomeLearning(apps: LearningApplicationRow[]): OutcomeLearningResult {
  const signals: OutcomeLearningSignal[] = []

  const generators = [remoteVsOnsiteSignal, matchScoreSignal, velocitySignal, ghostingSignal]
  for (const gen of generators) {
    const s = gen(apps)
    if (s) signals.push(s)
  }

  return {
    signals,
    feedbackNeeded: findFeedbackNeeded(apps),
    stats:          computeStats(apps),
    generatedAt:    new Date().toISOString(),
  }
}
