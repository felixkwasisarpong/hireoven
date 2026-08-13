import { getPostgresPool } from "@/lib/postgres/server"
import { getApexBehaviorSignals } from "@/lib/apex/behavior"
import { classifyBurnoutState } from "@/lib/apex/burnout/classifier"
import { getMemories } from "@/lib/apex/memory/store"
import { computeOutcomeLearning, type LearningApplicationRow } from "@/lib/apex/outcomes/learning"
import { getApexPlanExecutionSummary, type ApexPlanExecutionSummary } from "@/lib/apex/plan/server"
import {
  inferRoleCategory,
  inferSector,
  inferWorkMode,
  JOB_SECTOR_LABELS,
  ROLE_CATEGORY_LABELS,
  type JobSector,
  type RoleCategory,
} from "@/lib/apex/outcomes/categorizers"
import { runPipelineSimulation } from "@/lib/apex/pipeline-sim/simulator"
import { getLatestCareerTwin, saveCareerTwinSnapshot } from "./store"
import type {
  BuildCareerTwinInput,
  CareerTwinBuildReason,
  CareerTwinDimension,
  CareerTwinSnapshot,
} from "./types"

type ProfileRow = {
  desired_roles: string[] | null
  desired_locations: string[] | null
  needs_sponsorship: boolean
  visa_status: string | null
}

type ResumeRow = {
  updated_at: string | null
  summary: string | null
  top_skills: string[] | null
}

type TwinApplicationRow = LearningApplicationRow & {
  created_at: string
  is_hybrid?: boolean | null
  location?: string | null
}

type WatchlistStatsRow = {
  saved_count: number
  sponsor_friendly_count: number
}

type Bucket = {
  total: number
  positive: number
}

const POSITIVE_STATUSES = new Set(["phone_screen", "interview", "final_round", "offer"])
const NEGATIVE_STATUSES = new Set(["rejected", "withdrawn"])

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function round(value: number): number {
  return Math.round(value)
}

function daysSince(iso: string | null | undefined): number {
  if (!iso) return 999
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
}

function toConfidence(sampleSize: number): number {
  if (sampleSize <= 0) return 25
  if (sampleSize >= 12) return 95
  return clamp(30 + sampleSize * 6, 30, 95)
}

function adjustedRateScore(bucket: Bucket): number {
  if (bucket.total <= 0) return 50

  const rawRate = (bucket.positive / bucket.total) * 100
  const weight = Math.min(1, bucket.total / 6)
  return round(clamp(50 + (rawRate - 50) * weight, 5, 95))
}

function isPositiveStatus(status: string): boolean {
  return POSITIVE_STATUSES.has(status)
}

function isEvaluableApplication(app: TwinApplicationRow): boolean {
  if (isPositiveStatus(app.status) || NEGATIVE_STATUSES.has(app.status)) return true
  if (app.status === "applied") {
    return daysSince(app.applied_at ?? app.created_at) >= 21
  }
  return false
}

function inferPreferredWorkModes(
  behaviorLocations: string[],
  apps: TwinApplicationRow[]
): Array<"remote" | "hybrid" | "onsite"> {
  const modes = new Set<"remote" | "hybrid" | "onsite">()

  if (behaviorLocations.some((location) => location.toLowerCase() === "remote")) {
    modes.add("remote")
  }

  const counts = new Map<"remote" | "hybrid" | "onsite", number>()
  for (const app of apps) {
    const mode = inferWorkMode(app.is_remote, app.job_title, app.location)
    if (!mode) continue
    counts.set(mode, (counts.get(mode) ?? 0) + 1)
  }

  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1])
  for (const [mode] of ranked.slice(0, 2)) {
    modes.add(mode)
  }

  return [...modes]
}

function pickTopBucket<T extends string>(
  buckets: Map<T, Bucket>
): { key: T; stats: Bucket; score: number } | null {
  const ranked = [...buckets.entries()]
    .filter(([, stats]) => stats.total >= 2)
    .map(([key, stats]) => ({ key, stats, score: adjustedRateScore(stats) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return b.stats.total - a.stats.total
    })

  return ranked[0] ?? null
}

function buildBucketDimension<T extends string>(args: {
  keyPrefix: string
  category: CareerTwinDimension["category"]
  label: string
  bucketKey: T | null
  buckets: Map<T, Bucket>
  bucketLabel: (bucket: T) => string
  neutralEvidence: string
}): CareerTwinDimension {
  const { keyPrefix, category, label, bucketKey, buckets, bucketLabel, neutralEvidence } = args

  if (!bucketKey) {
    return {
      key: `${keyPrefix}_unknown`,
      label,
      category,
      direction: "neutral",
      score: 50,
      confidence: 25,
      evidence: [neutralEvidence],
      updatedAt: new Date().toISOString(),
    }
  }

  const bucket = buckets.get(bucketKey) ?? { total: 0, positive: 0 }
  const score = adjustedRateScore(bucket)
  const direction: CareerTwinDimension["direction"] =
    score >= 65 ? "strength" : score <= 40 ? "risk" : "neutral"

  return {
    key: `${keyPrefix}_${bucketKey}`,
    label,
    category,
    direction,
    score,
    confidence: toConfidence(bucket.total),
    evidence: [
      `${bucketLabel(bucketKey)} advanced ${bucket.positive} of ${bucket.total} evaluable applications.`,
    ],
    updatedAt: new Date().toISOString(),
  }
}

function buildSearchFocusScore(args: {
  profile: ProfileRow | null
  memoriesCount: number
  apps: TwinApplicationRow[]
  topRoleCount: number
}): CareerTwinDimension {
  const hasRoleTargets = Boolean(args.profile?.desired_roles?.length)
  const hasLocationTargets = Boolean(args.profile?.desired_locations?.length)
  const concentration = args.apps.length > 0 ? args.topRoleCount / args.apps.length : 0
  const memoryBoost = Math.min(args.memoriesCount, 3) * 8

  const score = clamp(
    (hasRoleTargets ? 30 : 0) +
      (hasLocationTargets ? 15 : 0) +
      round(concentration * 35) +
      memoryBoost,
    15,
    95
  )

  return {
    key: "search_focus_score",
    label: "Search focus score",
    category: "focus",
    direction: score >= 65 ? "strength" : score <= 40 ? "risk" : "neutral",
    score,
    confidence: args.apps.length >= 6 ? 80 : 55,
    evidence: [
      hasRoleTargets
        ? `Desired roles are set: ${(args.profile?.desired_roles ?? []).slice(0, 3).join(", ")}.`
        : "Desired roles are not explicitly set.",
      hasLocationTargets
        ? `Preferred locations are set: ${(args.profile?.desired_locations ?? []).slice(0, 3).join(", ")}.`
        : "Preferred locations are not explicitly set.",
    ],
    updatedAt: new Date().toISOString(),
  }
}

function buildTargetingAlignmentScore(apps: TwinApplicationRow[]): CareerTwinDimension {
  const withScores = apps.filter((app) => typeof app.match_score === "number")
  const averageScore =
    withScores.length > 0
      ? withScores.reduce((sum, app) => sum + (app.match_score ?? 0), 0) / withScores.length
      : 50

  const score = round(clamp(averageScore, 20, 95))

  return {
    key: "targeting_alignment_score",
    label: "Targeting alignment score",
    category: "fit",
    direction: score >= 70 ? "strength" : score <= 45 ? "risk" : "neutral",
    score,
    confidence: withScores.length > 0 ? toConfidence(withScores.length) : 30,
    evidence: [
      withScores.length > 0
        ? `Average recorded match score across ${withScores.length} tracked applications is ${round(averageScore)}%.`
        : "No recorded match scores yet — targeting alignment is still provisional.",
    ],
    updatedAt: new Date().toISOString(),
  }
}

function buildApplicationDisciplineScore(apps: TwinApplicationRow[], savedCount: number): CareerTwinDimension {
  const last14 = apps.filter((app) => daysSince(app.applied_at ?? app.created_at) <= 14).length
  const weekBuckets = [0, 1, 2, 3].map((offset) => {
    const min = offset * 7
    const max = min + 7
    return apps.filter((app) => {
      const age = daysSince(app.applied_at ?? app.created_at)
      return age >= min && age < max
    }).length
  })
  const activeWeeks = weekBuckets.filter((count) => count > 0).length
  const consistency = round((activeWeeks / 4) * 100)
  const pace = clamp(last14 * 20, 0, 100)
  const applyShare = apps.length + savedCount > 0 ? apps.length / (apps.length + savedCount) : 0.5
  const balance = round(applyShare * 100)
  const score = round(clamp(consistency * 0.4 + pace * 0.35 + balance * 0.25, 5, 95))

  return {
    key: "application_discipline_score",
    label: "Application discipline score",
    category: "momentum",
    direction: score >= 60 ? "strength" : score <= 35 ? "risk" : "neutral",
    score,
    confidence: apps.length >= 8 ? 85 : 60,
    evidence: [
      `${last14} tracked applications landed in the last 14 days.`,
      `${activeWeeks} of the last 4 weeks had at least one application.`,
    ],
    updatedAt: new Date().toISOString(),
  }
}

function buildExecutionFollowThroughScore(summary: ApexPlanExecutionSummary | null): CareerTwinDimension {
  if (
    !summary ||
    (summary.trailing7d.runCount <= 0 &&
      summary.trailing7d.doneCount <= 0 &&
      summary.trailing7d.deferredCount <= 0 &&
      summary.trailing7d.activeDays <= 0)
  ) {
    return {
      key: "execution_follow_through_score",
      label: "Execution follow-through",
      category: "momentum",
      direction: "neutral",
      score: 50,
      confidence: 25,
      evidence: ["No persisted Apex plan execution data is available yet."],
      updatedAt: new Date().toISOString(),
    }
  }

  const resolvedCount = summary.trailing7d.doneCount + summary.trailing7d.deferredCount
  const completionRate =
    resolvedCount > 0
      ? (summary.trailing7d.doneCount / resolvedCount) * 100
      : summary.trailing7d.runCount > 0
        ? 48
        : 50
  const cadenceScore = clamp((summary.trailing7d.activeDays / 5) * 100, 15, 100)
  const runSignalScore = clamp(summary.trailing7d.runCount * 14, 10, 100)
  const deferPressure = resolvedCount > 0 ? (summary.trailing7d.deferredCount / resolvedCount) * 100 : 0
  const score = round(
    clamp(
      completionRate * 0.55 + cadenceScore * 0.25 + runSignalScore * 0.2 - deferPressure * 0.15,
      10,
      95
    )
  )

  const confidence = round(
    clamp(
      35 +
        summary.trailing7d.activeDays * 8 +
        Math.min(summary.trailing7d.runCount, 6) * 4 +
        Math.min(resolvedCount, 5) * 3,
      35,
      92
    )
  )

  return {
    key: "execution_follow_through_score",
    label: "Execution follow-through",
    category: "momentum",
    direction: score >= 65 ? "strength" : score <= 40 ? "risk" : "neutral",
    score,
    confidence,
    evidence: [
      `Over the last 7 days, ${summary.trailing7d.doneCount} plan items were completed and ${summary.trailing7d.deferredCount} were deferred across ${summary.trailing7d.activeDays} active days.`,
      summary.today.runCount > 0
        ? `Today includes ${summary.today.runCount} run events with ${summary.today.doneCount} completed and ${summary.today.deferredCount} deferred.`
        : "No plan execution has been recorded yet today.",
    ],
    updatedAt: new Date().toISOString(),
  }
}

function buildResponseStrengthScore(
  totalApplications: number,
  responded: number,
  responseRate: number
): CareerTwinDimension {
  const score = round(clamp((responseRate / 30) * 100, 5, 95))

  return {
    key: "response_strength_score",
    label: "Response strength score",
    category: "fit",
    direction: score >= 60 ? "strength" : score <= 35 ? "risk" : "neutral",
    score,
    confidence: toConfidence(totalApplications),
    evidence: [
      `${responded} of ${totalApplications} tracked applications produced a recruiter response or later-stage movement.`,
    ],
    updatedAt: new Date().toISOString(),
  }
}

function buildInterviewConversionScore(
  responded: number,
  interviewed: number
): CareerTwinDimension {
  const rate = responded > 0 ? round((interviewed / responded) * 100) : 50
  const score = clamp(rate, 10, 95)

  return {
    key: "interview_conversion_score",
    label: "Interview conversion score",
    category: "readiness",
    direction: score >= 60 ? "strength" : score <= 35 ? "risk" : "neutral",
    score,
    confidence: toConfidence(responded),
    evidence: [
      responded > 0
        ? `${interviewed} of ${responded} response-stage applications moved into interview territory.`
        : "No response-stage applications yet, so interview conversion is still uncalibrated.",
    ],
    updatedAt: new Date().toISOString(),
  }
}

function buildOfferConversionScore(
  interviewed: number,
  offers: number
): CareerTwinDimension {
  const rate = interviewed > 0 ? round((offers / interviewed) * 100) : 50
  const score = clamp(rate, 10, 95)

  return {
    key: "offer_conversion_score",
    label: "Offer conversion score",
    category: "readiness",
    direction: score >= 55 ? "strength" : score <= 30 ? "risk" : "neutral",
    score,
    confidence: toConfidence(interviewed),
    evidence: [
      interviewed > 0
        ? `${offers} of ${interviewed} interview-stage applications reached offer stage.`
        : "No interview-stage conversions yet, so offer conversion is still provisional.",
    ],
    updatedAt: new Date().toISOString(),
  }
}

function buildPipelineMomentumScore(args: {
  applicationsSent: number
  responsesReceived: number
  phoneScreens: number
  onsiteInterviews: number
  offersReceived: number
  appsPerWeek: number
  weeksElapsed: number
}): CareerTwinDimension {
  const simulation = runPipelineSimulation(args)

  return {
    key: "pipeline_momentum_score",
    label: "Pipeline momentum score",
    category: "momentum",
    direction: simulation.momentumScore >= 60 ? "strength" : simulation.momentumScore <= 35 ? "risk" : "neutral",
    score: simulation.momentumScore,
    confidence: args.applicationsSent >= 8 ? 85 : 55,
    evidence: [simulation.bottleneckExplanation, simulation.scenarioQuality.label],
    updatedAt: new Date().toISOString(),
  }
}

function buildBurnoutRiskScore(state: Awaited<ReturnType<typeof classifyBurnoutState>>): CareerTwinDimension {
  const riskScoreMap: Record<string, number> = {
    healthy: 20,
    slowing: 45,
    stalled: 65,
    anxious: 78,
    burnt_out: 90,
  }
  const confidenceMap: Record<string, number> = {
    low: 50,
    medium: 72,
    high: 88,
  }
  const score = riskScoreMap[state.state] ?? 50

  return {
    key: "burnout_risk_score",
    label: "Search intensity",
    category: "risk",
    direction: score >= 55 ? "risk" : "neutral",
    score,
    confidence: confidenceMap[state.confidence] ?? 65,
    evidence: [
      `Burnout classifier currently reads ${state.state.replace(/_/g, " ")}.`,
      state.recommendation,
    ],
    updatedAt: new Date().toISOString(),
  }
}

function buildSponsorshipConstraintLevel(args: {
  profile: ProfileRow | null
  sponsorFriendlyCount: number
  savedCount: number
  behaviorSensitivity: string
}): CareerTwinDimension {
  const needsSponsorship = Boolean(args.profile?.needs_sponsorship)
  const visaStatus = args.profile?.visa_status?.toLowerCase() ?? ""

  let score = 25
  let evidence = "No strong sponsorship constraint detected from current profile data."

  if (needsSponsorship) {
    score = 82
    evidence = "Profile says the user needs employer sponsorship."
  } else if (args.behaviorSensitivity === "medium" || /f1|opt|h4|j1|tn|cpt|stem/.test(visaStatus)) {
    score = 62
    evidence = "Visa status may still narrow which employers are viable."
  }

  if (score >= 60 && args.savedCount > 0) {
    const sponsorRatio = args.sponsorFriendlyCount / args.savedCount
    if (sponsorRatio < 0.4) {
      score = clamp(score + 8, 0, 95)
      evidence = `${evidence} Only ${args.sponsorFriendlyCount} of ${args.savedCount} saved targets look sponsor-friendly.`
    }
  }

  return {
    key: "sponsorship_constraint_level",
    label: "Sponsorship constraint level",
    category: "constraint",
    direction: score >= 55 ? "constraint" : "neutral",
    score,
    confidence: args.profile ? 88 : 45,
    evidence: [evidence],
    updatedAt: new Date().toISOString(),
  }
}

function buildRemoteConversionStrength(apps: TwinApplicationRow[]): CareerTwinDimension {
  const remoteBucket: Bucket = { total: 0, positive: 0 }
  const otherBucket: Bucket = { total: 0, positive: 0 }

  for (const app of apps) {
    if (!isEvaluableApplication(app)) continue

    const mode = inferWorkMode(app.is_remote, app.job_title, app.location)
    const target = mode === "remote" ? remoteBucket : otherBucket
    target.total += 1
    if (isPositiveStatus(app.status)) target.positive += 1
  }

  if (remoteBucket.total < 2 || otherBucket.total < 2) {
    return {
      key: "remote_conversion_strength",
      label: "Remote conversion strength",
      category: "fit",
      direction: "neutral",
      score: 50,
      confidence: 25,
      evidence: ["Not enough remote vs non-remote outcome history yet."],
      updatedAt: new Date().toISOString(),
    }
  }

  const remoteRate = round((remoteBucket.positive / remoteBucket.total) * 100)
  const otherRate = round((otherBucket.positive / otherBucket.total) * 100)
  const delta = remoteRate - otherRate
  const score = clamp(50 + delta, 5, 95)

  return {
    key: "remote_conversion_strength",
    label: "Remote conversion strength",
    category: "fit",
    direction: delta >= 10 ? "strength" : delta <= -10 ? "risk" : "neutral",
    score,
    confidence: toConfidence(remoteBucket.total + otherBucket.total),
    evidence: [
      `Remote applications advanced ${remoteBucket.positive} of ${remoteBucket.total}.`,
      `Non-remote applications advanced ${otherBucket.positive} of ${otherBucket.total}.`,
    ],
    updatedAt: new Date().toISOString(),
  }
}

function buildStrengthsAndRisks(dimensions: CareerTwinDimension[]) {
  // Clean metric name for prose — the raw labels end in "score"/"level", which
  // reads awkwardly inline ("Targeting alignment score is a current strength").
  const name = (d: CareerTwinDimension) => d.label.replace(/\s+(score|level)$/i, "")
  const strengthDims = dimensions
    .filter((dimension) => dimension.direction === "strength")
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((dimension) => `${name(dimension)} is a current strength (${dimension.score}/100).`)

  const riskDims = dimensions
    .filter((dimension) => dimension.direction === "risk")
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((dimension) => `${name(dimension)} is a current drag (${dimension.score}/100).`)

  const constraintDims = dimensions
    .filter((dimension) => dimension.direction === "constraint")
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map((dimension) => `${name(dimension)} is shaping the search (${dimension.score}/100).`)

  return { strengthDims, riskDims, constraintDims }
}

function buildRecommendedFocus(dimensions: CareerTwinDimension[]): string[] {
  const focus: string[] = []

  const topRole = dimensions.find((dimension) => dimension.key.startsWith("role_fit_") && dimension.direction === "strength")
  if (topRole) {
    focus.push(`Bias the next batch toward ${topRole.label.toLowerCase()} because that lane is converting best.`)
  }

  const sponsorship = dimensions.find((dimension) => dimension.key === "sponsorship_constraint_level")
  if (sponsorship && sponsorship.score >= 60) {
    focus.push("Keep sponsor-friendly employers and roles with explicit immigration openness at the top of the queue.")
  }

  const targeting = dimensions.find((dimension) => dimension.key === "targeting_alignment_score")
  if (targeting && targeting.score <= 45) {
    focus.push("Narrow role criteria before the next application batch; current targeting is too loose.")
  }

  const burnout = dimensions.find((dimension) => dimension.key === "burnout_risk_score")
  if (burnout && burnout.score >= 65) {
    focus.push("Reduce breadth and operate in smaller, higher-conviction batches until energy recovers.")
  }

  const execution = dimensions.find((dimension) => dimension.key === "execution_follow_through_score")
  if (execution && execution.score <= 40) {
    focus.push("Shrink the active plan and finish deferred items before expanding the queue again.")
  } else if (execution && execution.score >= 70) {
    focus.push("Lean into plan-driven batches right now; execution follow-through is strong enough to support bigger swings.")
  }

  const response = dimensions.find((dimension) => dimension.key === "response_strength_score")
  if (response && response.score <= 35) {
    focus.push("Favor recent high-match postings and skip marginal fits until response quality improves.")
  }

  return focus.slice(0, 4)
}

function buildHeadline(args: {
  roleDimension: CareerTwinDimension
  sectorDimension: CareerTwinDimension
  burnoutDimension: CareerTwinDimension
  sponsorshipDimension: CareerTwinDimension
  executionDimension: CareerTwinDimension
}): string {
  const parts: string[] = []

  if (args.roleDimension.direction === "strength") {
    parts.push(`${args.roleDimension.label} is a working lane`)
  }
  if (args.sectorDimension.direction === "strength") {
    parts.push(`${args.sectorDimension.label.toLowerCase()} is outperforming baseline`)
  }
  if (args.executionDimension.direction === "strength" && args.executionDimension.score >= 70) {
    parts.push("execution rhythm is holding")
  }
  if (args.executionDimension.direction === "risk") {
    parts.push("follow-through is slipping")
  }
  if (args.sponsorshipDimension.direction === "constraint") {
    parts.push("sponsorship remains a real search constraint")
  }
  if (args.burnoutDimension.score >= 65) {
    parts.push("energy management needs attention")
  }

  return parts.length > 0
    ? parts.slice(0, 2).join("; ")
    : "Apex has enough signal to model the search, but the user profile is still early and lightly calibrated."
}

function buildSummary(args: {
  strengths: string[]
  risks: string[]
  constraints: string[]
  responseRate: number
  interviewRate: number
  offerRate: number
}): string {
  const firstStrength = args.strengths[0] ?? "No dominant strength is stable yet."
  const firstRisk = args.risks[0] ?? "No major drag stands out yet."
  const firstConstraint = args.constraints[0] ?? "Constraints are light from current data."

  return `${firstStrength} ${firstRisk} ${firstConstraint} Tracked funnel metrics currently show ${args.responseRate}% response, ${args.interviewRate}% interview, and ${args.offerRate}% offer rates.`
}

export async function buildCareerTwinSnapshot(
  userId: string,
  reason: CareerTwinBuildReason = "manual_refresh"
): Promise<CareerTwinSnapshot> {
  const pool = getPostgresPool()

  const [
    profileResult,
    resumeResult,
    applicationsResult,
    watchlistStatsResult,
    planExecution,
    behaviorSignals,
    memories,
    burnoutState,
  ] = await Promise.all([
    pool.query<ProfileRow>(
      `SELECT desired_roles, desired_locations, needs_sponsorship, visa_status
       FROM profiles
       WHERE id = $1
       LIMIT 1`,
      [userId]
    ),
    pool.query<ResumeRow>(
      `SELECT updated_at, summary, top_skills
       FROM resumes
       WHERE user_id = $1 AND parse_status = 'complete'
       ORDER BY is_primary DESC, updated_at DESC
       LIMIT 1`,
      [userId]
    ),
    pool.query<TwinApplicationRow>(
      `SELECT
         ja.id,
         ja.job_title,
         ja.company_name,
         ja.status,
         ja.apply_url,
         ja.match_score,
         ja.source,
         ja.applied_at,
         ja.notes,
         ja.created_at,
         j.id         AS job_id,
         j.is_remote,
         j.is_hybrid,
         j.location,
         j.company_id,
         c.sponsors_h1b,
         c.industry   AS company_industry
       FROM job_applications ja
       LEFT JOIN jobs j ON j.id = ja.job_id
       LEFT JOIN companies c ON c.id = j.company_id
       WHERE ja.user_id = $1
         AND ja.is_archived = false
         AND ja.status != 'saved'
         AND COALESCE(ja.applied_at, ja.created_at) >= NOW() - INTERVAL '12 months'
       ORDER BY COALESCE(ja.applied_at, ja.created_at) DESC
       LIMIT 250`,
      [userId]
    ),
    pool.query<WatchlistStatsRow>(
      `SELECT
         COUNT(*)::int AS saved_count,
         COUNT(*) FILTER (WHERE c.sponsors_h1b OR c.sponsorship_confidence >= 60)::int AS sponsor_friendly_count
       FROM watchlist w
       JOIN companies c ON c.id = w.company_id
       WHERE w.user_id = $1`,
      [userId]
    ),
    getApexPlanExecutionSummary(userId).catch(() => null),
    getApexBehaviorSignals(userId).catch(() => null),
    getMemories(userId, pool, { activeOnly: true }).catch(() => []),
    classifyBurnoutState(userId).catch(() => null),
  ])

  const profile = profileResult.rows[0] ?? null
  const resume = resumeResult.rows[0] ?? null
  const apps = applicationsResult.rows
  const watchlistStats = watchlistStatsResult.rows[0] ?? { saved_count: 0, sponsor_friendly_count: 0 }
  const learning = computeOutcomeLearning(apps)

  const roleBuckets = new Map<RoleCategory, Bucket>()
  const roleVolumeCounts = new Map<RoleCategory, number>()
  const sectorBuckets = new Map<JobSector, Bucket>()
  let topRoleCount = 0

  for (const app of apps) {
    const role = inferRoleCategory(app.job_title)
    const sector = inferSector(app.job_title, app.company_name, app.company_industry) ?? "other"

    const roleVolume = (roleVolumeCounts.get(role) ?? 0) + 1
    roleVolumeCounts.set(role, roleVolume)
    if (roleVolume > topRoleCount) topRoleCount = roleVolume

    if (isEvaluableApplication(app)) {
      const roleCurrent = roleBuckets.get(role) ?? { total: 0, positive: 0 }
      roleCurrent.total += 1
      if (isPositiveStatus(app.status)) roleCurrent.positive += 1
      roleBuckets.set(role, roleCurrent)

      const sectorCurrent = sectorBuckets.get(sector) ?? { total: 0, positive: 0 }
      sectorCurrent.total += 1
      if (isPositiveStatus(app.status)) sectorCurrent.positive += 1
      sectorBuckets.set(sector, sectorCurrent)
    }
  }

  const topRole = pickTopBucket(roleBuckets)
  const topSector = pickTopBucket(sectorBuckets)

  const roleDimension = buildBucketDimension({
    keyPrefix: "role_fit",
    category: "fit",
    label: topRole ? `${ROLE_CATEGORY_LABELS[topRole.key]} fit` : "Role fit",
    bucketKey: topRole?.key ?? null,
    buckets: roleBuckets,
    bucketLabel: (bucket) => ROLE_CATEGORY_LABELS[bucket],
    neutralEvidence: "Not enough repeated role-category history yet.",
  })

  const sectorDimension = buildBucketDimension({
    keyPrefix: "sector_fit",
    category: "fit",
    label: topSector ? `${JOB_SECTOR_LABELS[topSector.key]} fit` : "Sector fit",
    bucketKey: topSector?.key ?? null,
    buckets: sectorBuckets,
    bucketLabel: (bucket) => JOB_SECTOR_LABELS[bucket],
    neutralEvidence: "Not enough sector-specific outcome history yet.",
  })

  const responded = apps.filter((app) => isPositiveStatus(app.status)).length
  const interviewed = apps.filter((app) => ["interview", "final_round", "offer"].includes(app.status)).length
  const offers = apps.filter((app) => app.status === "offer").length
  const daysSinceFirst = apps.length > 0 ? Math.max(daysSince(apps[apps.length - 1]?.applied_at ?? apps[apps.length - 1]?.created_at), 1) : 1
  const weeksElapsed = Math.max(1, Math.ceil(daysSinceFirst / 7))
  const appsPerWeek = round((apps.length / weeksElapsed) * 10) / 10

  const dimensions: CareerTwinDimension[] = [
    roleDimension,
    sectorDimension,
    buildTargetingAlignmentScore(apps),
    buildApplicationDisciplineScore(apps, watchlistStats.saved_count),
    buildExecutionFollowThroughScore(planExecution),
    buildResponseStrengthScore(learning.stats.totalApplications, learning.stats.responded, learning.stats.responseRate),
    buildInterviewConversionScore(responded, interviewed),
    buildOfferConversionScore(interviewed, offers),
    buildPipelineMomentumScore({
      applicationsSent: learning.stats.totalApplications,
      responsesReceived: responded,
      phoneScreens: apps.filter((app) => ["phone_screen", "interview", "final_round", "offer"].includes(app.status)).length,
      onsiteInterviews: interviewed,
      offersReceived: offers,
      appsPerWeek: Math.max(1, appsPerWeek),
      weeksElapsed,
    }),
    buildRemoteConversionStrength(apps),
    buildSearchFocusScore({
      profile,
      memoriesCount: memories.length,
      apps,
      topRoleCount,
    }),
    buildSponsorshipConstraintLevel({
      profile,
      sponsorFriendlyCount: watchlistStats.sponsor_friendly_count,
      savedCount: watchlistStats.saved_count,
      behaviorSensitivity: behaviorSignals?.sponsorshipSensitivity ?? "unknown",
    }),
  ]

  if (burnoutState) {
    dimensions.push(buildBurnoutRiskScore(burnoutState))
  }

  const { strengthDims, riskDims, constraintDims } = buildStrengthsAndRisks(dimensions)
  const recommendedFocus = buildRecommendedFocus(dimensions)

  const freshnessScore = clamp(
    (apps.length > 0 && daysSince(apps[0]?.applied_at ?? apps[0]?.created_at) <= 14 ? 40 : 20) +
      (resume?.updated_at && daysSince(resume.updated_at) <= 30 ? 20 : 10) +
      ((planExecution?.today.runCount ?? 0) > 0 ? 10 : (planExecution?.trailing7d.activeDays ?? 0) > 0 ? 6 : 0) +
      (memories.length > 0 ? 15 : 5) +
      clamp(apps.length, 0, 25),
    20,
    100
  )

  const confidence = round(
    clamp(
      dimensions.reduce((sum, dimension) => sum + dimension.confidence, 0) / Math.max(dimensions.length, 1),
      25,
      95
    )
  )

  const headline = buildHeadline({
    roleDimension,
    sectorDimension,
    burnoutDimension: dimensions.find((dimension) => dimension.key === "burnout_risk_score") ?? {
      key: "burnout_risk_score",
      label: "Search intensity",
      category: "risk",
      direction: "neutral",
      score: 20,
      confidence: 25,
      evidence: [],
      updatedAt: new Date().toISOString(),
    },
    sponsorshipDimension: dimensions.find((dimension) => dimension.key === "sponsorship_constraint_level") ?? {
      key: "sponsorship_constraint_level",
      label: "Sponsorship constraint level",
      category: "constraint",
      direction: "neutral",
      score: 20,
      confidence: 25,
      evidence: [],
      updatedAt: new Date().toISOString(),
    },
    executionDimension: dimensions.find((dimension) => dimension.key === "execution_follow_through_score") ?? {
      key: "execution_follow_through_score",
      label: "Execution follow-through",
      category: "momentum",
      direction: "neutral",
      score: 50,
      confidence: 25,
      evidence: [],
      updatedAt: new Date().toISOString(),
    },
  })

  const summary = buildSummary({
    strengths: strengthDims,
    risks: riskDims,
    constraints: constraintDims,
    responseRate: learning.stats.responseRate,
    interviewRate: learning.stats.interviewRate,
    offerRate: learning.stats.offerRate,
  })

  const buildInput: BuildCareerTwinInput = {
    headline,
    summary,
    strengths: strengthDims,
    risks: riskDims,
    constraints: constraintDims,
    recommendedFocus,
    primaryRoleCategory: topRole?.key ?? null,
    primarySector: topSector?.key ?? null,
    preferredWorkModes: inferPreferredWorkModes(behaviorSignals?.preferredLocations ?? [], apps),
    confidence,
    freshnessScore,
    evidenceCount:
      apps.length +
      memories.length +
      (behaviorSignals ? 1 : 0) +
      (resume ? 1 : 0) +
      ((planExecution?.trailing7d.runCount ?? 0) > 0 ? 1 : 0),
    dimensions,
    reason,
    sourceStats: {
      applications: apps.length,
      memories: memories.length,
      responseRate: learning.stats.responseRate,
      interviewRate: learning.stats.interviewRate,
      offerRate: learning.stats.offerRate,
      watchlistCount: watchlistStats.saved_count,
      planTodayRuns: planExecution?.today.runCount ?? 0,
      planTodayDone: planExecution?.today.doneCount ?? 0,
      planTodayDeferred: planExecution?.today.deferredCount ?? 0,
      planTrailingRuns: planExecution?.trailing7d.runCount ?? 0,
      planTrailingDone: planExecution?.trailing7d.doneCount ?? 0,
      planTrailingDeferred: planExecution?.trailing7d.deferredCount ?? 0,
      planTrailingActiveDays: planExecution?.trailing7d.activeDays ?? 0,
    },
  }

  return saveCareerTwinSnapshot(userId, pool, buildInput)
}

export async function ensureFreshCareerTwin(
  userId: string,
  opts: { maxAgeHours?: number; reason?: CareerTwinBuildReason } = {}
): Promise<CareerTwinSnapshot> {
  const pool = getPostgresPool()
  const existing = await getLatestCareerTwin(userId, pool, {
    maxAgeHours: opts.maxAgeHours ?? 24,
  })

  if (existing) return existing
  return buildCareerTwinSnapshot(userId, opts.reason ?? "api_read_through")
}
