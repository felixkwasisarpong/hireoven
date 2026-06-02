import { getPostgresPool } from "@/lib/postgres/server"
import { getLatestCareerTwin } from "@/lib/apex/career-twin/store"
import { getApexPlanExecutionSummary } from "@/lib/apex/plan/server"
import { getApexStrategyBoard } from "@/lib/apex/strategy"
import { ROLE_CATEGORY_LABELS } from "@/lib/apex/outcomes/categorizers"
import type { CareerTwinDimension, CareerTwinSnapshot } from "@/lib/apex/career-twin/types"
import type { ApexAutonomousHuntPlan, ApexHuntAction, ApexHuntPosture, ApexHuntQueueItem, ApexHuntTrack } from "./types"

type ProfileRow = {
  desired_roles: string[] | null
  desired_locations: string[] | null
  needs_sponsorship: boolean
}

type ApplicationRow = {
  recent_applications: number
  active_applications: number
}

type SavedRow = {
  saved_jobs: number
}

type CandidateJobRow = {
  id: string
  title: string
  company_id: string | null
  company_name: string
  location: string | null
  is_remote: boolean
  is_hybrid: boolean
  first_detected_at: string
  sponsors_h1b: boolean | null
  sponsorship_score: number | null
  company_sponsorship_confidence: number | null
  overall_score: number | null
  already_applied: boolean
}

type HuntBias = {
  sponsorFirst: boolean
  freshnessFirst: boolean
  remoteFirst: boolean
  queueFirst: boolean
}

const ROLE_KEYWORDS: Record<string, string[]> = {
  backend: ["backend", "api", "server", "software engineer", "platform engineer"],
  platform: ["platform", "infrastructure", "developer platform", "internal tools", "backend"],
  ai_engineering: ["ai", "ml", "machine learning", "llm", "applied ai"],
  infra: ["devops", "sre", "site reliability", "infrastructure", "cloud"],
  ml_platform: ["ml platform", "mlops", "machine learning platform", "feature platform"],
  payments: ["payments", "fintech", "billing", "risk", "ledger"],
  security: ["security", "application security", "cloud security", "identity"],
  fullstack: ["full stack", "frontend", "fullstack", "software engineer"],
  data: ["data", "analytics", "etl", "warehouse", "data engineer"],
}

const KEEP_SHORT_ROLE_TOKENS = new Set(["ai", "ml", "qa", "ui", "ux", "sre"])
const TECHNICAL_TITLE_RE = /\b(engineer|developer|programmer|architect|platform|infrastructure|devops|site reliability|sre|security|data|ml|ai|machine learning|software|full stack|backend|frontend|cloud|analytics)\b/i

function parseBias(message?: string | null): HuntBias {
  const text = message?.trim() ?? ""
  return {
    sponsorFirst: /\b(sponsor|sponsorship|visa|h-?1b|immigration)\b/i.test(text),
    freshnessFirst: /\b(today|fresh|recent|new|this week)\b/i.test(text),
    remoteFirst: /\bremote\b/i.test(text),
    queueFirst: /\b(queue|top of the queue|highest-?conviction batch|attack plan)\b/i.test(text),
  }
}

function getDimension(snapshot: CareerTwinSnapshot | null, key: string): CareerTwinDimension | null {
  return snapshot?.dimensions.find((dimension) => dimension.key === key) ?? null
}

function getTargetLane(profile: ProfileRow | null, twin: CareerTwinSnapshot | null): string | null {
  const desiredRole = profile?.desired_roles?.find((role) => role.trim().length > 0)?.trim()
  if (desiredRole) return desiredRole
  if (twin?.primaryRoleCategory) {
    return ROLE_CATEGORY_LABELS[twin.primaryRoleCategory] ?? twin.primaryRoleCategory
  }
  return null
}

function getLaneKeywords(profile: ProfileRow | null, twin: CareerTwinSnapshot | null): string[] {
  const desiredRoles = profile?.desired_roles?.filter((role) => role.trim().length > 0) ?? []
  const roleTokens = desiredRoles
    .flatMap((role) => role.toLowerCase().split(/[^a-z0-9+.#-]+/i))
    .filter((token) => token.length >= 4 || KEEP_SHORT_ROLE_TOKENS.has(token))

  const roleKey = twin?.primaryRoleCategory
  const twinKeywords = roleKey && ROLE_KEYWORDS[roleKey] ? ROLE_KEYWORDS[roleKey] : []

  if (roleTokens.length > 0 || twinKeywords.length > 0) {
    return Array.from(new Set([...roleTokens, ...twinKeywords]))
  }

  if (roleKey && ROLE_KEYWORDS[roleKey]) {
    return ROLE_KEYWORDS[roleKey]
  }

  return ["software", "engineer", "backend"]
}

function getRoleFamilyRegex(targetLane: string | null, twin: CareerTwinSnapshot | null): RegExp | null {
  const lane = targetLane?.toLowerCase() ?? ""
  const category = twin?.primaryRoleCategory ?? null
  const engineeringLikeCategories = new Set(["backend", "frontend", "fullstack", "platform", "ml_ai", "devops_sre", "security", "mobile"])

  if (/\b(engineer|engineering|developer|architect|platform|backend|frontend|full stack|devops|sre)\b/i.test(lane)) {
    return /\b(engineer|developer|architect|programmer|sre|devops|mlops|scientist)\b/i
  }

  if (category && engineeringLikeCategories.has(category)) {
    return /\b(engineer|developer|architect|scientist|mlops|research)\b/i
  }

  if (category === "data" || /\b(data|analytics)\b/i.test(lane)) {
    return /\b(data|analytics|engineer|scientist|ml)\b/i
  }

  return null
}

function sponsorSignal(row: CandidateJobRow): number {
  return Math.max(
    row.sponsors_h1b ? 78 : 0,
    row.sponsorship_score ?? 0,
    row.company_sponsorship_confidence ?? 0,
  )
}

function workMode(row: CandidateJobRow): "remote" | "hybrid" | "onsite" {
  if (row.is_remote) return "remote"
  if (row.is_hybrid) return "hybrid"
  return "onsite"
}

function freshnessHours(iso: string): number {
  const delta = Date.now() - new Date(iso).getTime()
  return Math.max(0, Math.round(delta / 36e5))
}

function freshnessBoost(hours: number): number {
  if (hours <= 24) return 18
  if (hours <= 72) return 12
  if (hours <= 168) return 7
  if (hours <= 336) return 3
  return 0
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function keywordMatchesTitle(title: string, keyword: string): boolean {
  const trimmed = keyword.trim().toLowerCase()
  if (!trimmed) return false
  const normalizedTitle = title.toLowerCase()

  if (trimmed.includes(" ")) {
    return normalizedTitle.includes(trimmed)
  }

  return new RegExp(`\\b${escapeRegex(trimmed)}\\b`, "i").test(normalizedTitle)
}

function laneBoost(title: string, keywords: string[]): number {
  const matches = keywords.filter((keyword) => keywordMatchesTitle(title, keyword)).length
  if (matches >= 2) return 12
  if (matches === 1) return 7
  return 0
}

function determinePosture(args: {
  burnoutScore: number | null
  executionScore: number | null
  recentApplications: number
  doneCount7d: number
  deferredCount7d: number
  queueFirst: boolean
}): ApexHuntPosture {
  if ((args.burnoutScore ?? 0) >= 65 || args.deferredCount7d > args.doneCount7d + 1) {
    return "narrow"
  }
  if (args.queueFirst || args.recentApplications === 0 || (args.executionScore ?? 50) <= 40) {
    return "aggressive"
  }
  return "balanced"
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function buildReason(row: CandidateJobRow, laneAligned: boolean, hours: number, sponsorScore: number): string {
  const parts: string[] = []

  if (typeof row.overall_score === "number") {
    parts.push(`${Math.round(row.overall_score)} match`)
  }
  if (sponsorScore >= 70) {
    parts.push("strong sponsorship signal")
  }
  if (laneAligned) {
    parts.push("aligned to current lane")
  }
  if (hours <= 72) {
    parts.push(hours <= 24 ? "detected in the last day" : "fresh posting")
  }
  if (row.is_remote) {
    parts.push("remote")
  } else if (row.is_hybrid) {
    parts.push("hybrid")
  }

  if (parts.length === 0) {
    return "Worth tracking while the queue is still fresh."
  }

  const [first, ...rest] = parts
  return `${first[0]?.toUpperCase() ?? ""}${first.slice(1)}${rest.length > 0 ? `, ${rest.join(", ")}` : ""}.`
}

function buildOpportunityQuery(row: CandidateJobRow, needsSponsorship: boolean): string {
  const parts = [row.title, row.company_name].filter(Boolean).join(" at ")
  if (needsSponsorship) {
    return `Show roles similar to ${parts} with sponsorship-friendly employers and rank them by fit`
  }
  return `Show roles similar to ${parts} and rank them by fit`
}

function buildQueue(args: {
  rows: CandidateJobRow[]
  posture: ApexHuntPosture
  laneKeywords: string[]
  needsSponsorship: boolean
  bias: HuntBias
  technicalLane: boolean
  roleFamilyRegex: RegExp | null
}): ApexHuntQueueItem[] {
  const scored = args.rows
    .map((row) => {
      const sponsorScore = sponsorSignal(row)
      const hours = freshnessHours(row.first_detected_at)
      const laneScore = laneBoost(row.title, args.laneKeywords)
      const titleLooksTechnical = TECHNICAL_TITLE_RE.test(row.title)
      if (args.technicalLane && !titleLooksTechnical && laneScore === 0) {
        return null
      }
      if (args.roleFamilyRegex && !args.roleFamilyRegex.test(row.title)) {
        return null
      }

      let queueScore = row.overall_score ?? 52

      queueScore += freshnessBoost(hours)
      queueScore += laneScore

      if (args.needsSponsorship || args.bias.sponsorFirst) {
        queueScore += sponsorScore >= 75 ? 20 : sponsorScore >= 60 ? 10 : -14
      } else if (sponsorScore >= 70) {
        queueScore += 6
      }

      if (args.bias.remoteFirst) {
        queueScore += row.is_remote ? 12 : row.is_hybrid ? 5 : -8
      }

      if (row.already_applied) {
        queueScore -= 26
      }

      if (args.posture === "narrow" && (row.overall_score ?? 0) < 65) {
        queueScore -= 12
      }

      if (args.posture === "aggressive" && hours <= 72) {
        queueScore += 6
      }

      return {
        row,
        sponsorScore,
        hours,
        queueScore: clampScore(queueScore),
        laneAligned: laneScore > 0,
      }
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .sort((left, right) => right.queueScore - left.queueScore || left.hours - right.hours)
    .slice(0, 5)

  return scored.map(({ row, sponsorScore, hours, queueScore, laneAligned }) => ({
    id: row.id,
    jobId: row.id,
    title: row.title,
    companyId: row.company_id,
    companyName: row.company_name,
    location: row.location,
    workMode: workMode(row),
    matchScore: row.overall_score === null ? null : Math.round(row.overall_score),
    sponsorshipScore: sponsorScore,
    freshnessHours: hours,
    queueScore,
    reason: buildReason(row, laneAligned, hours, sponsorScore),
    feedQuery: buildOpportunityQuery(row, args.needsSponsorship),
    jobHref: `/dashboard/jobs/${row.id}`,
    companyHref: row.company_id ? `/dashboard/companies/${row.company_id}` : null,
  }))
}

function addUniqueAction(actions: ApexHuntAction[], next: ApexHuntAction) {
  if (!actions.some((action) => action.query === next.query || action.title === next.title)) {
    actions.push(next)
  }
}

function buildAttackPlan(args: {
  posture: ApexHuntPosture
  targetLane: string | null
  needsSponsorship: boolean
  recentApplications: number
  doneCount7d: number
  deferredCount7d: number
  responseScore: number | null
}): ApexHuntAction[] {
  const actions: ApexHuntAction[] = []

  if (args.needsSponsorship) {
    addUniqueAction(actions, {
      id: "sponsor-first",
      title: "Start with sponsor-friendly openings",
      why: "Sponsorship is a hard constraint, so the queue should start where immigration openness is explicit.",
      query: "Run autonomous hunt for sponsorship-friendly roles matching my profile",
      urgency: "now",
    })
  }

  if (args.posture === "narrow" || args.deferredCount7d > args.doneCount7d) {
    addUniqueAction(actions, {
      id: "close-deferred-loop",
      title: "Finish one deferred high-conviction step",
      why: "Execution is slipping. Closing one strong deferred step is more valuable than opening three weak ones.",
      query: "Show my deferred plan items and tell me which one to finish first",
      urgency: "now",
    })
  }

  if (args.recentApplications === 0 || (args.responseScore ?? 50) <= 45) {
    addUniqueAction(actions, {
      id: "fresh-high-fit-queue",
      title: "Re-rank the freshest high-fit roles",
      why: "The pipeline needs fresh, high-conviction shots instead of more broad searching.",
      query: "Run autonomous hunt for recent high-match roles and rank them by likelihood",
      urgency: "today",
    })
  }

  if (args.targetLane) {
    addUniqueAction(actions, {
      id: "lane-discipline",
      title: `Stay inside the ${args.targetLane} lane`,
      why: "Lane discipline protects match quality and keeps Apex from drifting into noisy searches.",
      query: `Show ${args.targetLane} roles matching my profile and rank them by fit`,
      urgency: actions.length === 0 ? "now" : "today",
    })
  }

  addUniqueAction(actions, {
    id: "attack-plan-refresh",
    title: "Refresh the full attack plan",
    why: "Use the hunt planner again after one move so Apex can tighten the queue around what is still alive.",
    query: "Run autonomous hunt for today",
    urgency: "watch",
  })

  return actions.slice(0, args.posture === "narrow" ? 3 : 4)
}

function buildTracks(args: {
  targetLane: string | null
  needsSponsorship: boolean
  activeApplications: number
  queue: ApexHuntQueueItem[]
}): ApexHuntTrack[] {
  const tracks: ApexHuntTrack[] = []

  if (args.targetLane) {
    tracks.push({
      id: "lane-track",
      title: `${args.targetLane} lane`,
      thesis: `Keep the next search batch inside ${args.targetLane}.`,
      reason: "This is where Apex currently sees the cleanest fit signal.",
      query: `Show ${args.targetLane} roles matching my profile and rank them by fit`,
      posture: "primary",
    })
  }

  if (args.needsSponsorship) {
    tracks.push({
      id: "sponsorship-track",
      title: "Immigration-open employers",
      thesis: "Keep employers with explicit sponsorship openness at the top of the queue.",
      reason: "This constraint is binary. Drift here wastes time.",
      query: "Find sponsorship-friendly roles matching my profile and rank them by likelihood",
      posture: "primary",
    })
  }

  if (args.activeApplications > 0) {
    tracks.push({
      id: "pipeline-track",
      title: "Pipeline conversion",
      thesis: "Protect active applications while the fresh queue is building.",
      reason: "A live pipeline is still your fastest route to interviews.",
      query: "What should I do next across my applications?",
      posture: "secondary",
    })
  }

  const topCompany = args.queue[0]?.companyName
  if (topCompany) {
    tracks.push({
      id: "company-track",
      title: `${topCompany} cluster`,
      thesis: `Use the top queue signal around ${topCompany} as a benchmark for similar targets.`,
      reason: "The leading queue item is a useful anchor for adjacent opportunities.",
      query: `Research companies similar to ${topCompany} and rank them by hiring likelihood`,
      posture: "watch",
    })
  }

  return tracks.slice(0, 3)
}

function buildGuardrails(args: {
  posture: ApexHuntPosture
  needsSponsorship: boolean
  strategyFocus: string[]
  strategyRiskTitles: string[]
}): string[] {
  const guardrails: string[] = []

  if (args.needsSponsorship) {
    guardrails.push("Do not spend the first pass on employers with no visible sponsorship signal.")
  }

  if (args.posture === "narrow") {
    guardrails.push("Do not open more than two new search branches before one priority action is completed.")
  }

  guardrails.push("Skip stale low-signal roles unless they are unusually strong fits.")

  if (args.strategyFocus.length > 0) {
    guardrails.push(`Stay aligned with Apex focus: ${args.strategyFocus[0]}.`)
  }

  if (args.strategyRiskTitles.length > 0) {
    guardrails.push(`Watch the current weak spot: ${args.strategyRiskTitles[0]}.`)
  }

  return Array.from(new Set(guardrails)).slice(0, 4)
}

function buildWhyNow(args: {
  strategyFocus: string[]
  recentApplications: number
  activeApplications: number
  queue: ApexHuntQueueItem[]
  deferredCount7d: number
}): string[] {
  const whyNow = [...args.strategyFocus]

  if (args.recentApplications === 0) {
    whyNow.push("The live pipeline is thin, so Apex should prioritize fresh conversion moves now.")
  }

  if (args.activeApplications > 0) {
    whyNow.push("You already have live applications, so the queue should complement rather than distract from them.")
  }

  if (args.queue[0]) {
    whyNow.push(`${args.queue[0].companyName} surfaced at the top of the queue with a ${args.queue[0].queueScore} hunt score.`)
  }

  if (args.deferredCount7d > 0) {
    whyNow.push("Deferred execution is visible, so the plan is biased toward fewer, stronger moves.")
  }

  return Array.from(new Set(whyNow)).slice(0, 4)
}

function buildSummary(args: {
  posture: ApexHuntPosture
  targetLane: string | null
  needsSponsorship: boolean
  queue: ApexHuntQueueItem[]
}): string {
  const lane = args.targetLane ?? "current target lane"
  const opener =
    args.posture === "narrow"
      ? "Operate in a tight hunt"
      : args.posture === "aggressive"
        ? "Push the market harder"
        : "Run a disciplined balanced hunt"

  const queueLine = args.queue[0]
    ? `${args.queue[0].title} at ${args.queue[0].companyName} is the current lead opportunity.`
    : "Apex needs more live opportunities to build a stronger queue."

  const sponsorLine = args.needsSponsorship
    ? "Sponsorship openness is being treated as a hard ordering signal."
    : "Queue order is being driven primarily by fit, freshness, and execution discipline."

  return `${opener} around ${lane}. ${queueLine} ${sponsorLine}`
}

export async function buildAutonomousHuntPlan(userId: string, message?: string | null): Promise<ApexAutonomousHuntPlan> {
  const pool = getPostgresPool()
  const bias = parseBias(message)

  const [profileResult, applicationsResult, savedResult, candidateResult, twin, planExecution, strategyBoard] = await Promise.all([
    pool.query<ProfileRow>(
      `SELECT desired_roles, desired_locations, needs_sponsorship
       FROM profiles
       WHERE id = $1
       LIMIT 1`,
      [userId],
    ),
    pool.query<ApplicationRow>(
      `SELECT
         COUNT(*) FILTER (
           WHERE is_archived = false
             AND COALESCE(applied_at, created_at) >= NOW() - INTERVAL '14 days'
         )::int AS recent_applications,
         COUNT(*) FILTER (
           WHERE is_archived = false
             AND status IN ('applied', 'phone_screen', 'interview', 'final_round', 'offer')
         )::int AS active_applications
       FROM job_applications
       WHERE user_id = $1`,
      [userId],
    ),
    pool.query<SavedRow>(
      `SELECT COUNT(*)::int AS saved_jobs
       FROM watchlist
       WHERE user_id = $1`,
      [userId],
    ),
    pool.query<CandidateJobRow>(
      `SELECT
         j.id,
         j.title,
         c.id AS company_id,
         COALESCE(c.name, 'Unknown company') AS company_name,
         j.location,
         j.is_remote,
         j.is_hybrid,
         j.first_detected_at,
         j.sponsors_h1b,
         j.sponsorship_score::int AS sponsorship_score,
         c.sponsorship_confidence::int AS company_sponsorship_confidence,
         score.overall_score,
         EXISTS(
           SELECT 1
           FROM job_applications ja
           WHERE ja.user_id = $1
             AND ja.job_id = j.id
             AND ja.is_archived = false
             AND ja.status NOT IN ('saved', 'rejected', 'withdrawn')
         ) AS already_applied
       FROM jobs j
       LEFT JOIN companies c ON c.id = j.company_id
       LEFT JOIN LATERAL (
         SELECT overall_score
         FROM job_match_scores
         WHERE user_id = $1
           AND job_id = j.id
         ORDER BY computed_at DESC
         LIMIT 1
       ) AS score ON TRUE
       WHERE j.is_active = true
         AND j.first_detected_at >= NOW() - INTERVAL '21 days'
       ORDER BY GREATEST(
         COALESCE(score.overall_score, 0),
         COALESCE(j.sponsorship_score, 0),
         COALESCE(c.sponsorship_confidence, 0),
         CASE WHEN j.sponsors_h1b = true THEN 78 ELSE 0 END
       ) DESC,
       j.first_detected_at DESC
       LIMIT 60`,
      [userId],
    ),
    getLatestCareerTwin(userId, pool).catch(() => null),
    getApexPlanExecutionSummary(userId).catch(() => ({
      today: { runCount: 0, doneCount: 0, deferredCount: 0 },
      trailing7d: { runCount: 0, doneCount: 0, deferredCount: 0, activeDays: 0 },
      frequentDeferredTitles: [],
      frequentCompletedTitles: [],
      executionFingerprint: "0|0|0|0|0|0|0|_|_",
    })),
    getApexStrategyBoard(userId).catch(() => null),
  ])

  const profile = profileResult.rows[0] ?? null
  const applicationSnapshot = applicationsResult.rows[0] ?? { recent_applications: 0, active_applications: 0 }
  const savedJobs = savedResult.rows[0]?.saved_jobs ?? 0

  const targetLane = getTargetLane(profile, twin)
  const laneKeywords = getLaneKeywords(profile, twin)
  const technicalLane = Boolean(twin?.primaryRoleCategory) || laneKeywords.some((keyword) => TECHNICAL_TITLE_RE.test(keyword))
  const roleFamilyRegex = getRoleFamilyRegex(targetLane, twin)
  const burnoutScore = getDimension(twin, "burnout_risk_score")?.score ?? null
  const executionScore = getDimension(twin, "execution_follow_through_score")?.score ?? null
  const responseScore = getDimension(twin, "response_strength_score")?.score ?? null
  const posture = determinePosture({
    burnoutScore,
    executionScore,
    recentApplications: applicationSnapshot.recent_applications,
    doneCount7d: planExecution.trailing7d.doneCount,
    deferredCount7d: planExecution.trailing7d.deferredCount,
    queueFirst: bias.queueFirst,
  })

  const queue = buildQueue({
    rows: candidateResult.rows,
    posture,
    laneKeywords,
    needsSponsorship: Boolean(profile?.needs_sponsorship),
    bias,
    technicalLane,
    roleFamilyRegex,
  })

  const attackPlan = buildAttackPlan({
    posture,
    targetLane,
    needsSponsorship: Boolean(profile?.needs_sponsorship),
    recentApplications: applicationSnapshot.recent_applications,
    doneCount7d: planExecution.trailing7d.doneCount,
    deferredCount7d: planExecution.trailing7d.deferredCount,
    responseScore,
  })

  const tracks = buildTracks({
    targetLane,
    needsSponsorship: Boolean(profile?.needs_sponsorship),
    activeApplications: applicationSnapshot.active_applications,
    queue,
  })

  const guardrails = buildGuardrails({
    posture,
    needsSponsorship: Boolean(profile?.needs_sponsorship),
    strategyFocus: strategyBoard?.todayFocus ?? [],
    strategyRiskTitles: strategyBoard?.risks.map((risk) => risk.title) ?? [],
  })

  const whyNow = buildWhyNow({
    strategyFocus: strategyBoard?.todayFocus ?? [],
    recentApplications: applicationSnapshot.recent_applications,
    activeApplications: applicationSnapshot.active_applications,
    queue,
    deferredCount7d: planExecution.trailing7d.deferredCount,
  })

  const topQueueScore = queue[0]?.queueScore ?? null
  const freshSponsorCount = queue.filter((item) => item.freshnessHours <= 72 && item.sponsorshipScore >= 70).length

  return {
    generatedAt: new Date().toISOString(),
    posture,
    summary: buildSummary({
      posture,
      targetLane,
      needsSponsorship: Boolean(profile?.needs_sponsorship),
      queue,
    }),
    operatingRule:
      posture === "narrow"
        ? "Convert one strong move before expanding the queue."
        : posture === "aggressive"
          ? "Prioritize fresh, high-conviction opportunities while the pipeline is thin."
          : "Hold the lane steady and keep the queue fresh without widening too fast.",
    targetLane,
    whyNow,
    attackPlan,
    queue,
    tracks,
    guardrails,
    signals: {
      sponsorshipRequired: Boolean(profile?.needs_sponsorship),
      targetLane,
      preferredLocation: profile?.desired_locations?.find((location) => location.trim().length > 0)?.trim() ?? null,
      recentApplications: applicationSnapshot.recent_applications,
      activeApplications: applicationSnapshot.active_applications,
      savedJobs,
      executionRunCount7d: planExecution.trailing7d.runCount,
      executionDeferredCount7d: planExecution.trailing7d.deferredCount,
      executionDoneCount7d: planExecution.trailing7d.doneCount,
      topQueueScore,
      freshSponsorCount,
    },
  }
}
