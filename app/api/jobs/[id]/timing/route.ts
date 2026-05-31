import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { computeJobTiming } from "@/lib/apex/timing/timing-engine"

export const runtime = "nodejs"
export const maxDuration = 30

type CachedScoreRow = {
  timing_recommendation: string
  timing_reason: string
  optimal_apply_at: string | null
  screen_rate_multiplier: string
  hours_since_posted: number | null
  posted_at: string | null
  computed_at: string
}

type SignalRow = {
  day_of_week: number
  hour_of_day: number
  screen_rate: string
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

// Groups heatmap hours into display buckets
const HEATMAP_HOURS = [9, 11, 14, 18]
const HEATMAP_LABELS = ["9–11am", "11am–2pm", "2–5pm", "Evening"]

function screenRateLabel(rate: number): string {
  if (rate >= 0.15) return "Best"
  if (rate >= 0.10) return "Good"
  if (rate >= 0.07) return "Average"
  return "Low"
}

function buildHeatmapData(signals: SignalRow[]) {
  // Mon–Fri (days 1–5) × 4 hour buckets
  const rows: Array<{
    dayOfWeek: number
    dayLabel: string
    hour: number
    hourLabel: string
    screenRate: number
    label: string
  }> = []

  for (let day = 1; day <= 5; day++) {
    for (let bi = 0; bi < HEATMAP_HOURS.length; bi++) {
      const bucketStart = HEATMAP_HOURS[bi]!
      const bucketEnd   = HEATMAP_HOURS[bi + 1] ?? 23

      // Average screen_rate across hours in this bucket for this day
      const matching = signals.filter(
        (s) => s.day_of_week === day && s.hour_of_day >= bucketStart && s.hour_of_day < bucketEnd,
      )
      const avg =
        matching.length > 0
          ? matching.reduce((sum, s) => sum + parseFloat(s.screen_rate), 0) / matching.length
          : 0.04

      rows.push({
        dayOfWeek: day,
        dayLabel: DAY_NAMES[day]!,
        hour: bucketStart,
        hourLabel: HEATMAP_LABELS[bi]!,
        screenRate: Math.round(avg * 10000) / 10000,
        label: screenRateLabel(avg),
      })
    }
  }

  return rows
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const pool = getPostgresPool()

  // Check cache — valid for 1 hour
  const cached = await pool.query<CachedScoreRow>(
    `SELECT timing_recommendation, timing_reason, optimal_apply_at,
            screen_rate_multiplier, hours_since_posted, posted_at, computed_at
     FROM job_timing_scores
     WHERE job_id = $1
       AND computed_at > now() - INTERVAL '1 hour'
     LIMIT 1`,
    [id],
  )

  let score: CachedScoreRow | null = cached.rows[0] ?? null

  if (!score) {
    // Fetch company_id for this job
    const jobRow = await pool.query<{ company_id: string | null }>(
      `SELECT company_id FROM jobs WHERE id = $1 LIMIT 1`,
      [id],
    )
    const companyId = jobRow.rows[0]?.company_id ?? undefined
    const computed = await computeJobTiming(id, companyId)
    score = {
      timing_recommendation:  computed.timingRecommendation,
      timing_reason:          computed.timingReason,
      optimal_apply_at:       computed.optimalApplyAt,
      screen_rate_multiplier: String(computed.screenRateMultiplier),
      hours_since_posted:     computed.hoursSincePosted,
      posted_at:              computed.postedAt,
      computed_at:            computed.computedAt,
    }
  }

  // Fetch signals for heatmap (global fallback)
  const signalResult = await pool.query<SignalRow>(
    `SELECT day_of_week, hour_of_day, screen_rate
     FROM application_timing_signals
     WHERE company_id IS NULL
     ORDER BY day_of_week, hour_of_day`,
  )
  const heatmapData = buildHeatmapData(signalResult.rows)

  // Fetch ATS type for this job
  const atsRow = await pool.query<{ apply_url: string | null }>(
    `SELECT apply_url FROM jobs WHERE id = $1 LIMIT 1`,
    [id],
  )
  const applyUrl = atsRow.rows[0]?.apply_url ?? null

  return NextResponse.json({
    timingRecommendation:  score.timing_recommendation,
    timingReason:          score.timing_reason,
    optimalApplyAt:        score.optimal_apply_at,
    screenRateMultiplier:  parseFloat(score.screen_rate_multiplier),
    hoursSincePosted:      score.hours_since_posted ?? 9999,
    postedAt:              score.posted_at,
    computedAt:            score.computed_at,
    applyUrl,
    heatmapData,
  })
}
