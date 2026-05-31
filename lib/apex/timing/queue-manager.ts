import { getPostgresPool } from "@/lib/postgres/server"
import { computeJobTiming } from "./timing-engine"
import type { TimingRecommendation } from "./timing-engine"

export type ApplicationQueueStatus = "ready" | "scheduled" | "waiting"

export type ApplicationQueueItem = {
  jobId: string
  jobTitle: string
  companyName: string
  matchScore: number | null
  timingRecommendation: TimingRecommendation
  timingReason: string
  optimalApplyAt: string | null
  screenRateMultiplier: number
  atsType: string | null
  hoursPosted: number
  status: ApplicationQueueStatus
}

type SavedJobRow = {
  job_id: string
  job_title: string | null
  company_name: string | null
  match_score: number | null
  apply_url: string | null
  company_id: string | null
}

type CachedScoreRow = {
  job_id: string
  timing_recommendation: string
  timing_reason: string
  optimal_apply_at: string | null
  screen_rate_multiplier: string
  hours_since_posted: number | null
  computed_at: string
}

const RECOMMENDATION_ORDER: Record<TimingRecommendation, number> = {
  apply_now:          0,
  schedule_today:     1,
  schedule_tomorrow:  2,
  low_priority:       3,
}

function queueStatus(rec: TimingRecommendation): ApplicationQueueStatus {
  if (rec === "apply_now") return "ready"
  if (rec === "schedule_today" || rec === "schedule_tomorrow") return "scheduled"
  return "waiting"
}

export async function getTimingOptimizedQueue(userId: string): Promise<ApplicationQueueItem[]> {
  const pool = getPostgresPool()

  // Fetch saved/queued jobs for user (watchlist + saved applications not yet applied)
  const jobsResult = await pool.query<SavedJobRow>(
    `SELECT DISTINCT
       j.id            AS job_id,
       j.title         AS job_title,
       c.name          AS company_name,
       jms.score       AS match_score,
       j.apply_url,
       j.company_id
     FROM watchlist w
     JOIN jobs j ON j.id = w.job_id
     LEFT JOIN companies c ON c.id = j.company_id
     LEFT JOIN job_match_scores jms ON jms.job_id = j.id AND jms.user_id = w.user_id
     WHERE w.user_id = $1
       AND NOT EXISTS (
         SELECT 1 FROM job_applications ja
         WHERE ja.job_id = j.id AND ja.user_id = $1
           AND ja.status IN ('applied','interviewing','offer','rejected')
           AND ja.is_archived = false
       )
     ORDER BY j.id
     LIMIT 50`,
    [userId],
  )
  const savedJobs = jobsResult.rows

  if (savedJobs.length === 0) return []

  const jobIds = savedJobs.map((j) => j.job_id)

  // Fetch any cached timing scores (valid for 6 hours for queue view)
  const scoresResult = await pool.query<CachedScoreRow>(
    `SELECT job_id, timing_recommendation, timing_reason, optimal_apply_at,
            screen_rate_multiplier, hours_since_posted, computed_at
     FROM job_timing_scores
     WHERE job_id = ANY($1)
       AND computed_at > now() - INTERVAL '6 hours'`,
    [jobIds],
  )
  const cachedMap = new Map<string, CachedScoreRow>(
    scoresResult.rows.map((r) => [r.job_id, r]),
  )

  // Compute missing scores (in parallel, cap concurrency at 5)
  const uncached = savedJobs.filter((j) => !cachedMap.has(j.job_id))
  const CONCURRENCY = 5
  for (let i = 0; i < uncached.length; i += CONCURRENCY) {
    const batch = uncached.slice(i, i + CONCURRENCY)
    await Promise.all(
      batch.map(async (j) => {
        try {
          const score = await computeJobTiming(j.job_id, j.company_id ?? undefined)
          cachedMap.set(j.job_id, {
            job_id:                 j.job_id,
            timing_recommendation:  score.timingRecommendation,
            timing_reason:          score.timingReason,
            optimal_apply_at:       score.optimalApplyAt,
            screen_rate_multiplier: String(score.screenRateMultiplier),
            hours_since_posted:     score.hoursSincePosted,
            computed_at:            score.computedAt,
          })
        } catch {
          // Non-fatal: item gets low_priority defaults
        }
      }),
    )
  }

  // Build queue items
  const items: ApplicationQueueItem[] = savedJobs.map((j) => {
    const score = cachedMap.get(j.job_id)
    const rec = (score?.timing_recommendation ?? "low_priority") as TimingRecommendation
    return {
      jobId:                j.job_id,
      jobTitle:             j.job_title ?? "Unknown Role",
      companyName:          j.company_name ?? "Unknown Company",
      matchScore:           j.match_score ?? null,
      timingRecommendation: rec,
      timingReason:         score?.timing_reason ?? "Timing data unavailable.",
      optimalApplyAt:       score?.optimal_apply_at ?? null,
      screenRateMultiplier: parseFloat(score?.screen_rate_multiplier ?? "1.0"),
      atsType:              null,
      hoursPosted:          score?.hours_since_posted ?? 9999,
      status:               queueStatus(rec),
    }
  })

  // Sort: apply_now → schedule_today → schedule_tomorrow → low_priority
  // Within apply_now: by screenRateMultiplier desc
  // Within scheduled: by optimalApplyAt asc
  items.sort((a, b) => {
    const orderDiff = RECOMMENDATION_ORDER[a.timingRecommendation] - RECOMMENDATION_ORDER[b.timingRecommendation]
    if (orderDiff !== 0) return orderDiff

    if (a.timingRecommendation === "apply_now") {
      return b.screenRateMultiplier - a.screenRateMultiplier
    }
    if (a.timingRecommendation === "schedule_today" || a.timingRecommendation === "schedule_tomorrow") {
      const aT = a.optimalApplyAt ? new Date(a.optimalApplyAt).getTime() : Infinity
      const bT = b.optimalApplyAt ? new Date(b.optimalApplyAt).getTime() : Infinity
      return aT - bT
    }
    return 0
  })

  return items
}
