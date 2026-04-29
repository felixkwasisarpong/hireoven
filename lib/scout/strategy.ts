import { getPostgresPool } from "@/lib/postgres/server"
import type {
  ScoutStrategyBoard,
  ScoutStrategyMove,
  ScoutStrategyRisk,
  ScoutWeakSignal,
} from "./types"

type ProfileSummary = {
  desired_roles: string[] | null
  desired_locations: string[] | null
  needs_sponsorship: boolean
}

type ResumeSummary = {
  id: string
  summary: string | null
  top_skills: string[] | null
}

type ApplicationSnapshot = {
  active_count: number
  recent_count: number
}

type MatchSummary = {
  recent_avg_score: number | null
  sampled_count: number
  low_count: number
}

type CompanyTarget = {
  id: string
  name: string
  sponsors_h1b: boolean
  sponsorship_confidence: number
}

type JobTarget = {
  id: string
  title: string
  company_name: string
  overall_score: number | null
}

type CountRow = {
  count: number
}

export async function getScoutStrategyBoard(userId: string): Promise<ScoutStrategyBoard> {
  const pool = getPostgresPool()

  const [
    profileResult,
    resumeResult,
    watchlistCountResult,
    applicationsResult,
    matchSummaryResult,
    alertsCountResult,
    sponsorshipTargetResult,
    topSavedJobResult,
  ] = await Promise.all([
    pool.query<ProfileSummary>(
      `SELECT desired_roles, desired_locations, needs_sponsorship
       FROM profiles
       WHERE id = $1
       LIMIT 1`,
      [userId]
    ),
    pool.query<ResumeSummary>(
      `SELECT id, summary, top_skills
       FROM resumes
       WHERE user_id = $1
         AND parse_status = 'complete'
       ORDER BY is_primary DESC, updated_at DESC
       LIMIT 1`,
      [userId]
    ),
    pool.query<CountRow>(
      `SELECT COUNT(*)::int AS count
       FROM watchlist
       WHERE user_id = $1`,
      [userId]
    ),
    pool.query<ApplicationSnapshot>(
      `SELECT
         COUNT(*) FILTER (
           WHERE is_archived = false
             AND status IN ('applied', 'phone_screen', 'interview', 'final_round')
         )::int AS active_count,
         COUNT(*) FILTER (
           WHERE is_archived = false
             AND COALESCE(applied_at, created_at) >= NOW() - INTERVAL '14 days'
         )::int AS recent_count
       FROM job_applications
       WHERE user_id = $1`,
      [userId]
    ),
    pool.query<MatchSummary>(
      `SELECT
         AVG(sample.overall_score)::float AS recent_avg_score,
         COUNT(*)::int AS sampled_count,
         COUNT(*) FILTER (WHERE sample.overall_score < 55)::int AS low_count
       FROM (
         SELECT overall_score
         FROM job_match_scores
         WHERE user_id = $1
         ORDER BY computed_at DESC
         LIMIT 20
       ) AS sample`,
      [userId]
    ),
    pool.query<CountRow>(
      `SELECT COUNT(*)::int AS count
       FROM job_alerts
       WHERE user_id = $1
         AND is_active = true`,
      [userId]
    ),
    pool.query<CompanyTarget>(
      `SELECT c.id, c.name, c.sponsors_h1b, c.sponsorship_confidence
       FROM watchlist w
       INNER JOIN companies c ON c.id = w.company_id
       WHERE w.user_id = $1
       ORDER BY c.sponsors_h1b DESC, c.sponsorship_confidence DESC, w.created_at DESC
       LIMIT 1`,
      [userId]
    ),
    pool.query<JobTarget>(
      `SELECT
         j.id,
         j.title,
         c.name AS company_name,
         score.overall_score
       FROM watchlist w
       INNER JOIN companies c ON c.id = w.company_id
       INNER JOIN jobs j ON j.company_id = c.id AND j.is_active = true
       LEFT JOIN LATERAL (
         SELECT overall_score
         FROM job_match_scores
         WHERE user_id = $1
           AND job_id = j.id
         ORDER BY computed_at DESC
         LIMIT 1
       ) AS score ON TRUE
       WHERE w.user_id = $1
       ORDER BY score.overall_score DESC NULLS LAST, j.first_detected_at DESC
       LIMIT 1`,
      [userId]
    ),
  ])

  const profile = profileResult.rows[0] ?? null
  const resume = resumeResult.rows[0] ?? null
  const savedJobs = watchlistCountResult.rows[0]?.count ?? 0
  const activeApplications = applicationsResult.rows[0]?.active_count ?? 0
  const recentApplications = applicationsResult.rows[0]?.recent_count ?? 0
  const averageMatchScoreRaw = matchSummaryResult.rows[0]?.recent_avg_score ?? null
  const averageMatchScore =
    typeof averageMatchScoreRaw === "number"
      ? Math.round(averageMatchScoreRaw)
      : null
  const sampledScores = matchSummaryResult.rows[0]?.sampled_count ?? 0
  const lowScores = matchSummaryResult.rows[0]?.low_count ?? 0
  const activeAlerts = alertsCountResult.rows[0]?.count ?? 0
  const topCompany = sponsorshipTargetResult.rows[0] ?? null
  const topSavedJob = topSavedJobResult.rows[0] ?? null

  const hasDesiredRoles = Boolean(profile?.desired_roles?.length)
  const hasDesiredLocations = Boolean(profile?.desired_locations?.length)
  const hasPreferences = hasDesiredRoles || hasDesiredLocations
  const hasResumeContext = Boolean(
    resume && (resume.summary?.trim() || (resume.top_skills?.length ?? 0) > 0)
  )
  const sponsorshipNeeds = Boolean(profile?.needs_sponsorship)
  const sponsorshipFriendlySignals = Boolean(
    topCompany && (topCompany.sponsors_h1b || topCompany.sponsorship_confidence >= 60)
  )
  const lowMatchSignal =
    sampledScores >= 4 && lowScores >= Math.max(2, Math.ceil(sampledScores * 0.5))

  const risks: ScoutStrategyRisk[] = []
  if (!hasResumeContext) {
    risks.push({
      id: "missing-resume-context",
      title: "Missing resume context",
      description: "Add resume summary and core skills so Scout can personalize guidance better.",
      severity: "high",
    })
  }
  if (lowMatchSignal) {
    risks.push({
      id: "low-match-scores",
      title: "Low recent match scores",
      description: "Recent scored jobs are trending low. Tighten targeting or tailor resume keywords.",
      severity: "medium",
    })
  }
  if (recentApplications === 0) {
    risks.push({
      id: "no-recent-applications",
      title: "No recent applications",
      description: "No applications in the last 14 days. Momentum may be dropping.",
      severity: "high",
    })
  }
  if (sponsorshipNeeds && !sponsorshipFriendlySignals) {
    risks.push({
      id: "sponsorship-uncertainty",
      title: "Sponsorship uncertainty",
      description: "Current targets do not show strong sponsorship signals yet.",
      severity: "medium",
    })
  }
  if (!hasPreferences) {
    risks.push({
      id: "empty-preferences",
      title: "Search preferences are incomplete",
      description: "Add desired roles/locations to improve ranking and filtering quality.",
      severity: "low",
    })
  }

  const todayFocus = buildTodayFocus({
    savedJobs,
    hasResumeContext,
    sponsorshipNeeds,
    recentApplications,
    activeApplications,
    hasPreferences,
  })

  const nextMoves = buildNextMoves({
    resumeId: resume?.id,
    topSavedJob,
    topCompany,
    preferredRole: profile?.desired_roles?.[0] ?? null,
    sponsorshipNeeds,
    activeAlerts,
  })

  const weakSignals = buildWeakSignals({
    hasResumeContext,
    hasPreferences,
    lowMatchSignal,
    recentApplications,
    sponsorshipNeeds,
    sponsorshipFriendlySignals,
    savedJobs,
    activeApplications,
    sampledScores,
    averageMatchScore,
  })

  return {
    todayFocus,
    snapshot: {
      savedJobs,
      activeApplications,
      recentApplications,
      averageMatchScore,
    },
    risks: risks.slice(0, 5),
    nextMoves,
    weakSignals,
  }
}

function buildTodayFocus(input: {
  savedJobs: number
  hasResumeContext: boolean
  sponsorshipNeeds: boolean
  recentApplications: number
  activeApplications: number
  hasPreferences: boolean
}): string[] {
  const focus: string[] = []

  if (input.savedJobs > 0) focus.push("Review high-match saved jobs")
  if (!input.hasResumeContext) focus.push("Improve resume gaps for stronger match quality")
  if (input.sponsorshipNeeds) focus.push("Check sponsorship-friendly roles")
  if (input.recentApplications === 0) focus.push("Submit 1-2 targeted applications this week")
  if (input.activeApplications > 0) focus.push("Follow up on active application pipeline")
  if (!input.hasPreferences) focus.push("Set role and location preferences to sharpen targeting")

  const fallback = [
    "Review fresh job opportunities that match your goals",
    "Strengthen your resume for the roles you want most",
    "Build a consistent weekly application rhythm",
  ]

  const unique = Array.from(new Set([...focus, ...fallback]))
  return unique.slice(0, 3)
}

function buildNextMoves(input: {
  resumeId: string | undefined
  topSavedJob: JobTarget | null
  topCompany: CompanyTarget | null
  preferredRole: string | null
  sponsorshipNeeds: boolean
  activeAlerts: number
}): ScoutStrategyMove[] {
  const moves: ScoutStrategyMove[] = []

  if (input.topSavedJob) {
    moves.push({
      id: "open-top-saved-job",
      title: "Review your strongest saved role",
      description: `${input.topSavedJob.title} at ${input.topSavedJob.company_name}`,
      action: {
        type: "OPEN_JOB",
        payload: { jobId: input.topSavedJob.id },
        label: "Open top saved job",
      },
    })
  }

  if (input.resumeId) {
    moves.push({
      id: "resume-tailor-baseline",
      title: "Tighten resume before next applications",
      description: "Use resume tailor to fix weak spots and add missing keywords.",
      action: {
        type: "OPEN_RESUME_TAILOR",
        payload: { resumeId: input.resumeId },
        label: "Open resume tailor",
      },
    })
  }

  if (input.sponsorshipNeeds) {
    moves.push({
      id: "sponsorship-filter",
      title: "Filter for sponsorship-friendly roles",
      description: "Prioritize roles with stronger sponsorship likelihood.",
      action: {
        type: "APPLY_FILTERS",
        payload: { sponsorship: "high" },
        label: "Apply sponsorship filter",
      },
    })
  }

  if (input.topCompany) {
    moves.push({
      id: "open-target-company",
      title: "Research a target company",
      description: `Check fit and sponsorship signals for ${input.topCompany.name}.`,
      action: {
        type: "OPEN_COMPANY",
        payload: { companyId: input.topCompany.id },
        label: "Open company profile",
      },
    })
  }

  if (input.activeAlerts === 0) {
    moves.push({
      id: "seed-alert-query",
      title: "Seed your search with a focused query",
      description: "Start with your likely target role and refine from there.",
      action: {
        type: "APPLY_FILTERS",
        payload: { query: input.preferredRole ?? "software engineer" },
        label: "Apply starter filters",
      },
    })
  }

  if (moves.length < 3) {
    moves.push({
      id: "refresh-priority-feed",
      title: "Refresh your priority feed",
      description: "Re-rank opportunities around roles worth your time this week.",
      action: {
        type: "APPLY_FILTERS",
        payload: { query: input.preferredRole ?? "backend" },
        label: "Refine feed",
      },
    })
  }

  return moves.slice(0, 5)
}

function buildWeakSignals(input: {
  hasResumeContext: boolean
  hasPreferences: boolean
  lowMatchSignal: boolean
  recentApplications: number
  sponsorshipNeeds: boolean
  sponsorshipFriendlySignals: boolean
  savedJobs: number
  activeApplications: number
  sampledScores: number
  averageMatchScore: number | null
}): ScoutWeakSignal[] {
  const signals: ScoutWeakSignal[] = []

  // ── Hard warnings ────────────────────────────────────────────────────────────

  if (!input.hasResumeContext) {
    signals.push({
      id: "missing-resume-context",
      title: "No resume context",
      description:
        "Scout can't personalize scoring or suggestions without a parsed resume. Upload and complete your primary resume.",
      severity: "warning",
    })
  }

  if (input.recentApplications === 0) {
    signals.push({
      id: "no-recent-applications",
      title: "No applications in the last 14 days",
      description:
        "Momentum matters in job searches. Even 1–2 targeted applications per week keeps pipelines warm.",
      severity: "warning",
    })
  }

  if (input.lowMatchSignal) {
    signals.push({
      id: "low-match-scores",
      title: "Match scores trending low",
      description:
        "Recent scored jobs are below 55. Tighten targeting with better filters or add missing skills to your resume.",
      severity: "warning",
    })
  }

  if (input.sponsorshipNeeds && !input.sponsorshipFriendlySignals) {
    signals.push({
      id: "sponsorship-uncertainty",
      title: "Sponsorship-friendly targets are unclear",
      description:
        "Your profile flags sponsorship need, but current saved companies don't show strong H-1B signals. Add sponsorship filter or save target companies.",
      severity: "warning",
    })
  }

  // ── Info signals ─────────────────────────────────────────────────────────────

  if (!input.hasPreferences) {
    signals.push({
      id: "empty-preferences",
      title: "Role and location preferences missing",
      description:
        "Set desired roles and locations in your profile so Scout can rank and filter more precisely.",
      severity: "info",
    })
  }

  if (
    input.sampledScores > 0 &&
    input.averageMatchScore !== null &&
    input.averageMatchScore >= 70 &&
    input.activeApplications === 0
  ) {
    signals.push({
      id: "high-scores-no-apps",
      title: "Strong matches but no applications yet",
      description:
        "You have well-scoring jobs but haven't applied. Consider converting at least one high-match role soon.",
      severity: "info",
    })
  }

  // ── Opportunities ─────────────────────────────────────────────────────────────

  if (input.savedJobs >= 3 && input.recentApplications === 0) {
    signals.push({
      id: "saved-jobs-idle",
      title: "Saved jobs waiting for action",
      description:
        "You have saved jobs but no recent applications. Review your watchlist — some roles may be strong targets now.",
      severity: "opportunity",
    })
  }

  if (input.sponsorshipNeeds && input.sponsorshipFriendlySignals) {
    signals.push({
      id: "sponsorship-targets-ready",
      title: "Sponsorship-friendly companies in your watchlist",
      description:
        "Your saved companies show good H-1B signals. Prioritize applications here before the pipeline goes stale.",
      severity: "opportunity",
    })
  }

  return signals.slice(0, 5)
}

