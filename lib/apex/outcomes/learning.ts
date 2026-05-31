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
  // V2 enrichment — populated via company join in the API query
  sponsors_h1b?:       boolean | null
  company_industry?:   string | null
  job_id?:             string | null
  company_id?:         string | null
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

// ── V2 Signal generators ──────────────────────────────────────────────────────

import { inferRoleCategory, inferSector } from "./categorizers"

/**
 * Role-type traction: which role category produces the most positive outcomes?
 * Requires at least 6 terminal applications to derive a reliable pattern.
 */
function roleTypeTractionSignal(apps: LearningApplicationRow[]): OutcomeLearningSignal | null {
  const terminal = apps.filter(isTerminal)
  if (terminal.length < 6) return null

  // Group by inferred role category
  const buckets = new Map<string, Bucket>()
  for (const app of terminal) {
    const cat = inferRoleCategory(app.job_title)
    const b = buckets.get(cat) ?? { total: 0, positive: 0 }
    b.total++
    if (isPositiveOutcome(app)) b.positive++
    buckets.set(cat, b)
  }

  // Need at least 2 categories with ≥2 applications each to compare
  const eligible = [...buckets.entries()].filter(([, b]) => b.total >= 2)
  if (eligible.length < 2) return null

  // Find the best-performing category vs rest
  const ranked = eligible
    .map(([cat, b]) => ({ cat, rate: rate(b), total: b.total, positive: b.positive }))
    .sort((a, b) => b.rate - a.rate)

  const best = ranked[0]
  const rest = ranked.slice(1)
  const avgRest = rest.length
    ? Math.round(rest.reduce((s, x) => s + x.rate, 0) / rest.length)
    : 0

  if (best.rate - avgRest < 15) return null

  const { ROLE_CATEGORY_LABELS } = require("./categorizers")
  const label = ROLE_CATEGORY_LABELS[best.cat] ?? best.cat

  return {
    id:        `role-traction-${best.cat}`,
    signal:    `${label} roles appear to produce stronger responses for your profile (${best.rate}% response vs ${avgRest}% avg for other categories).`,
    evidence:  [`${best.positive} of ${best.total} ${label} applications advanced`],
    confidence: confidenceFromCount(terminal.length),
    suggestedAction: `Prioritise ${label.toLowerCase()} roles in your next application batch`,
    dimension:  "role_type",
  }
}

/**
 * Sector traction: which industry sector responds better?
 * Requires company name + industry data (V2 enriched row).
 */
function sectorTractionSignal(apps: LearningApplicationRow[]): OutcomeLearningSignal | null {
  const terminal = apps.filter(isTerminal)
  if (terminal.length < 6) return null

  const buckets = new Map<string, Bucket>()
  for (const app of terminal) {
    const sector = inferSector(app.job_title, app.company_name, app.company_industry)
    if (!sector) continue
    const b = buckets.get(sector) ?? { total: 0, positive: 0 }
    b.total++
    if (isPositiveOutcome(app)) b.positive++
    buckets.set(sector, b)
  }

  const eligible = [...buckets.entries()].filter(([, b]) => b.total >= 2)
  if (eligible.length < 2) return null

  const ranked = eligible
    .map(([sector, b]) => ({ sector, rate: rate(b), total: b.total, positive: b.positive }))
    .sort((a, b) => b.rate - a.rate)

  const best = ranked[0]
  const rest = ranked.slice(1)
  const avgRest = rest.length
    ? Math.round(rest.reduce((s, x) => s + x.rate, 0) / rest.length)
    : 0

  if (best.rate - avgRest < 15) return null

  const { JOB_SECTOR_LABELS } = require("./categorizers")
  const label = JOB_SECTOR_LABELS[best.sector] ?? best.sector

  return {
    id:        `sector-traction-${best.sector}`,
    signal:    `${label} applications appear to convert better for your profile (${best.rate}% response vs ${avgRest}% for other sectors).`,
    evidence:  [`${best.positive} of ${best.total} ${label} applications advanced`],
    confidence: confidenceFromCount(terminal.length),
    suggestedAction: `Target ${label.toLowerCase()} companies in your next applications`,
    dimension:  "company_type",
  }
}

/**
 * Sponsorship-friendly companies: do H-1B sponsors respond better?
 * Only computed when the enriched row includes sponsors_h1b.
 */
function sponsorshipFriendlySignal(apps: LearningApplicationRow[]): OutcomeLearningSignal | null {
  const withSponsorData = apps.filter(
    (a) => isTerminal(a) && typeof a.sponsors_h1b === "boolean",
  )
  if (withSponsorData.length < 5) return null

  const sponsors    = withSponsorData.filter((a) => a.sponsors_h1b === true)
  const nonSponsors = withSponsorData.filter((a) => a.sponsors_h1b === false)
  if (sponsors.length < 2 || nonSponsors.length < 2) return null

  const sponsorRate    = rate({ total: sponsors.length,    positive: sponsors.filter(isPositiveOutcome).length })
  const nonSponsorRate = rate({ total: nonSponsors.length, positive: nonSponsors.filter(isPositiveOutcome).length })
  const diff = sponsorRate - nonSponsorRate

  if (Math.abs(diff) < 12) return null

  if (diff > 0) {
    return {
      id:        "sponsorship-friendly-better",
      signal:    `H-1B sponsoring companies appear to respond more often for your profile (${sponsorRate}% vs ${nonSponsorRate}% for non-sponsoring).`,
      evidence:  [`${sponsors.filter(isPositiveOutcome).length} of ${sponsors.length} sponsor-company applications advanced`],
      confidence: confidenceFromCount(withSponsorData.length),
      suggestedAction: "Prioritise sponsorship-friendly companies when searching",
      dimension:  "sponsorship",
    }
  } else {
    return {
      id:        "non-sponsor-better",
      signal:    `Applications to non-sponsoring companies seem to progress further (${nonSponsorRate}% vs ${sponsorRate}% for H-1B sponsors). This can indicate application volume or role fit differences.`,
      evidence:  [`${nonSponsors.filter(isPositiveOutcome).length} of ${nonSponsors.length} non-sponsor applications advanced`],
      confidence: confidenceFromCount(withSponsorData.length),
      suggestedAction: "Review application targeting — sponsorship signal alone may not be the deciding factor",
      dimension:  "sponsorship",
    }
  }
}

/**
 * Workflow conversion: applications from Scout's apply queue (source="scout_bulk")
 * vs manually submitted — which converts better?
 */
function workflowConversionSignal(apps: LearningApplicationRow[]): OutcomeLearningSignal | null {
  const terminal = apps.filter(isTerminal)
  if (terminal.length < 6) return null

  const workflow = terminal.filter((a) => a.source === "scout_bulk")
  const manual   = terminal.filter((a) => a.source !== "scout_bulk")
  if (workflow.length < 2 || manual.length < 2) return null

  const workflowRate = rate({ total: workflow.length, positive: workflow.filter(isPositiveOutcome).length })
  const manualRate   = rate({ total: manual.length,   positive: manual.filter(isPositiveOutcome).length })
  const diff = workflowRate - manualRate

  if (Math.abs(diff) < 10) return null

  if (diff > 0) {
    return {
      id:        "workflow-converts-better",
      signal:    `Applications prepared via Scout's apply queue appear to get more responses (${workflowRate}% vs ${manualRate}% for manually submitted). Tailored resumes and cover letters may be contributing.`,
      evidence:  [`${workflow.filter(isPositiveOutcome).length} of ${workflow.length} queue-prepared applications advanced`],
      confidence: confidenceFromCount(terminal.length),
      suggestedAction: "Continue using Scout's apply queue with tailoring for new applications",
      dimension:  "general",
    }
  } else {
    return {
      id:        "manual-converts-better",
      signal:    `Manually submitted applications appear to advance at a slightly higher rate (${manualRate}% vs ${workflowRate}%). This could reflect targeted, high-intent applications.`,
      evidence:  [`${manual.filter(isPositiveOutcome).length} of ${manual.length} manual applications advanced`],
      confidence: confidenceFromCount(terminal.length),
      suggestedAction: "Focus queue preparation on roles where you have a strong match score",
      dimension:  "general",
    }
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

export function computeOutcomeLearning(apps: LearningApplicationRow[]): OutcomeLearningResult {
  const signals: OutcomeLearningSignal[] = []

  const generators = [
    remoteVsOnsiteSignal,
    matchScoreSignal,
    velocitySignal,
    ghostingSignal,
    // V2 generators
    roleTypeTractionSignal,
    sectorTractionSignal,
    sponsorshipFriendlySignal,
    workflowConversionSignal,
  ]
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
