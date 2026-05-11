import { getPostgresPool } from "@/lib/postgres/server"

export type TimingRecommendation = "apply_now" | "schedule_today" | "schedule_tomorrow" | "low_priority"

export type JobTimingScore = {
  jobId: string
  postedAt: string | null
  hoursSincePosted: number
  timingRecommendation: TimingRecommendation
  timingReason: string
  optimalApplyAt: string | null
  screenRateMultiplier: number
  computedAt: string
}

type SignalRow = {
  day_of_week: number
  hour_of_day: number
  screen_rate: string
  sample_size: number
}

type JobRow = {
  id: string
  posted_at: string | null
  company_id: string | null
}

function isGoodWindow(d: Date): boolean {
  const day = d.getDay()
  const hour = d.getHours()
  return day >= 1 && day <= 3 && hour >= 9 && hour < 12
}

function isBadWindow(d: Date): boolean {
  const day = d.getDay()
  const hour = d.getHours()
  if (day === 0 || day === 6) return true       // weekend
  if (day === 5 && hour >= 12) return true       // Fri afternoon
  if (hour >= 18) return true                    // any evening
  return false
}

function findNextWindow(from: Date, signals: SignalRow[]): Date | null {
  if (signals.length === 0) return null

  const sorted = signals
    .slice()
    .sort((a, b) => parseFloat(String(b.screen_rate)) - parseFloat(String(a.screen_rate)))

  for (let daysAhead = 0; daysAhead < 8; daysAhead++) {
    for (const sig of sorted) {
      const candidate = new Date(from)
      candidate.setDate(candidate.getDate() + daysAhead)
      if (candidate.getDay() !== sig.day_of_week) continue
      candidate.setHours(sig.hour_of_day, 0, 0, 0)
      if (candidate > from) return candidate
    }
  }

  // Fallback: next Monday 9am
  const monday = new Date(from)
  while (monday.getDay() !== 1) monday.setDate(monday.getDate() + 1)
  monday.setHours(9, 0, 0, 0)
  return monday
}

export async function computeJobTiming(
  jobId: string,
  companyId?: string,
): Promise<JobTimingScore> {
  const pool = getPostgresPool()
  const now = new Date()

  // Fetch job row. jobs.first_detected_at is aliased to posted_at because
  // downstream code + the job_timing_scores schema use the posted_at name.
  const jobResult = await pool.query<JobRow>(
    `SELECT id, first_detected_at AS posted_at, company_id FROM jobs WHERE id = $1 LIMIT 1`,
    [jobId],
  )
  const job = jobResult.rows[0] ?? null
  const postedAt = job?.posted_at ?? null
  const resolvedCompanyId = companyId ?? job?.company_id ?? null

  const hoursSincePosted = postedAt
    ? Math.floor((now.getTime() - new Date(postedAt).getTime()) / 3_600_000)
    : 9999

  // Post-age scoring
  let baseRecommendation: TimingRecommendation
  let baseMultiplier: number
  let baseReason: string

  if (hoursSincePosted <= 24) {
    baseRecommendation = "apply_now"
    baseMultiplier = 3.1
    baseReason = `Posted ${hoursSincePosted} hour${hoursSincePosted === 1 ? "" : "s"} ago. Applications in the first 24 hours have a 3.1× higher screen rate.`
  } else if (hoursSincePosted <= 48) {
    baseRecommendation = "apply_now"
    baseMultiplier = 2.4
    baseReason = "Still in the early window. Apply before day 3 for best results."
  } else if (hoursSincePosted <= 72) {
    baseRecommendation = "schedule_today"
    baseMultiplier = 1.8
    baseReason = "Past the peak window. Still worth applying today."
  } else if (hoursSincePosted <= 168) {
    baseRecommendation = "schedule_tomorrow"
    baseMultiplier = 1.0
    baseReason = "Post is a few days old. Schedule for the best time slot."
  } else {
    baseRecommendation = "low_priority"
    baseMultiplier = 0.7
    const days = Math.floor(hoursSincePosted / 24)
    baseReason = `Post is ${days} day${days === 1 ? "" : "s"} old. Focus on fresher postings first.`
  }

  // Fetch timing signals: company-specific first, fall back to global
  let signals: SignalRow[] = []

  if (resolvedCompanyId) {
    const companySignals = await pool.query<SignalRow>(
      `SELECT day_of_week, hour_of_day, screen_rate, sample_size
       FROM application_timing_signals
       WHERE company_id = $1
       ORDER BY screen_rate DESC`,
      [resolvedCompanyId],
    )
    signals = companySignals.rows
  }

  if (signals.length === 0) {
    const globalSignals = await pool.query<SignalRow>(
      `SELECT day_of_week, hour_of_day, screen_rate, sample_size
       FROM application_timing_signals
       WHERE company_id IS NULL
       ORDER BY screen_rate DESC`,
    )
    signals = globalSignals.rows
  }

  const optimalWindow = findNextWindow(now, signals)
  const optimalApplyAt = optimalWindow ? optimalWindow.toISOString() : null

  // Adjust recommendation based on current time window
  let recommendation = baseRecommendation
  let reason = baseReason

  if (baseRecommendation === "apply_now") {
    if (isBadWindow(now) && optimalWindow) {
      recommendation = "schedule_today"
      const fmt = optimalWindow.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", weekday: "short" })
      reason = `${baseReason} However, right now is a low-response window. Scheduling for ${fmt} will improve your chances.`
    }
    // isGoodWindow → keep apply_now, reason unchanged
  }

  // Persist to job_timing_scores
  await pool.query(
    `INSERT INTO job_timing_scores
       (job_id, posted_at, hours_since_posted, timing_recommendation,
        timing_reason, optimal_apply_at, screen_rate_multiplier, computed_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now(), now())
     ON CONFLICT (job_id) DO UPDATE SET
       posted_at             = EXCLUDED.posted_at,
       hours_since_posted    = EXCLUDED.hours_since_posted,
       timing_recommendation = EXCLUDED.timing_recommendation,
       timing_reason         = EXCLUDED.timing_reason,
       optimal_apply_at      = EXCLUDED.optimal_apply_at,
       screen_rate_multiplier = EXCLUDED.screen_rate_multiplier,
       computed_at           = EXCLUDED.computed_at,
       updated_at            = EXCLUDED.updated_at`,
    [jobId, postedAt, hoursSincePosted, recommendation, reason, optimalApplyAt, baseMultiplier],
  )

  return {
    jobId,
    postedAt,
    hoursSincePosted,
    timingRecommendation: recommendation,
    timingReason: reason,
    optimalApplyAt,
    screenRateMultiplier: baseMultiplier,
    computedAt: now.toISOString(),
  }
}
