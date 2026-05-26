import { getPostgresPool } from "@/lib/postgres/server"
import type { ApplicationStatus, PipelineStats } from "@/types"

type ApplicationStatsRow = {
  status: string
  applied_at: string | null
  created_at: string
  timeline: Array<{ auto?: boolean; status?: string; date?: string }> | null
}

const APPLICATION_STATUSES: ApplicationStatus[] = [
  "saved",
  "applied",
  "phone_screen",
  "interview",
  "final_round",
  "offer",
  "rejected",
  "withdrawn",
]

const STATUS_SET = new Set<ApplicationStatus>(APPLICATION_STATUSES)

function emptyStatusCounts(): Record<ApplicationStatus, number> {
  return {
    saved: 0,
    applied: 0,
    phone_screen: 0,
    interview: 0,
    final_round: 0,
    offer: 0,
    rejected: 0,
    withdrawn: 0,
  }
}

export function computePipelineStats(applications: ApplicationStatsRow[]): PipelineStats {
  const by_status = emptyStatusCounts()

  for (const app of applications) {
    if (!STATUS_SET.has(app.status as ApplicationStatus)) continue
    by_status[app.status as ApplicationStatus] = (by_status[app.status as ApplicationStatus] ?? 0) + 1
  }

  const total = applications.length
  const applied =
    by_status.applied +
    by_status.phone_screen +
    by_status.interview +
    by_status.final_round +
    by_status.offer +
    by_status.rejected +
    by_status.withdrawn

  const responded =
    by_status.phone_screen +
    by_status.interview +
    by_status.final_round +
    by_status.offer +
    by_status.rejected +
    by_status.withdrawn

  const response_rate = applied > 0 ? Math.round((responded / applied) * 100) : 0

  const applied_to_phone =
    by_status.applied > 0
      ? Math.round((by_status.phone_screen / (by_status.applied + by_status.phone_screen)) * 100)
      : 0
  const phone_to_interview =
    by_status.phone_screen + by_status.interview > 0
      ? Math.round((by_status.interview / (by_status.phone_screen + by_status.interview)) * 100)
      : 0
  const interview_to_offer =
    by_status.interview + by_status.final_round + by_status.offer > 0
      ? Math.round((by_status.offer / (by_status.interview + by_status.final_round + by_status.offer)) * 100)
      : 0
  const overall = applied > 0 ? Math.round((by_status.offer / applied) * 100) : 0

  const responseTimes: number[] = []
  for (const app of applications) {
    if (!app.applied_at) continue
    const timeline = Array.isArray(app.timeline) ? app.timeline : []
    const firstResponse = timeline.find((entry) => {
      if (!entry?.auto || typeof entry.status !== "string") return false
      return entry.status !== "saved" && entry.status !== "applied"
    })
    if (!firstResponse?.date) continue
    const responseDate = new Date(firstResponse.date)
    if (Number.isNaN(responseDate.getTime())) continue

    const days = (responseDate.getTime() - new Date(app.applied_at).getTime()) / 86_400_000
    if (days >= 0 && days < 365) responseTimes.push(days)
  }
  const avg_days_to_response =
    responseTimes.length > 0
      ? Math.round(responseTimes.reduce((sum, value) => sum + value, 0) / responseTimes.length)
      : 0

  const now = Date.now()
  const weekAgo = now - 7 * 86_400_000
  const monthAgo = now - 30 * 86_400_000

  const applications_this_week = applications.filter((app) => {
    const ts = Date.parse(app.created_at)
    return Number.isFinite(ts) && ts >= weekAgo
  }).length

  const applications_this_month = applications.filter((app) => {
    const ts = Date.parse(app.created_at)
    return Number.isFinite(ts) && ts >= monthAgo
  }).length

  return {
    total,
    by_status,
    conversion_rates: {
      applied_to_phone,
      phone_to_interview,
      interview_to_offer,
      overall,
    },
    avg_days_to_response,
    avg_days_in_interview: 0,
    applications_this_week,
    applications_this_month,
    response_rate,
  }
}

export async function fetchPipelineStatsForUser(userId: string): Promise<PipelineStats> {
  const pool = getPostgresPool()
  const result = await pool.query<ApplicationStatsRow>(
    `SELECT status, applied_at, created_at, timeline
     FROM job_applications
     WHERE user_id = $1::uuid
       AND is_archived = false`,
    [userId],
  )

  return computePipelineStats(result.rows)
}
