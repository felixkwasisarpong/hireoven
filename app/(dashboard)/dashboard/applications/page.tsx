import { getSessionUser } from "@/lib/auth/session-user"
import { domainFromApplyUrl } from "@/lib/applications/company-domain"
import { getPostgresPool } from "@/lib/postgres/server"
import type { ApplicationStatus, JobApplication, PipelineStats } from "@/types"
import ApplicationsPageClient from "./ApplicationsPageClient"

export const dynamic = "force-dynamic"

type ApplicationsInitialData = {
  initialApplications: JobApplication[]
  initialStats: PipelineStats | null
  initialLoaded: boolean
}

const STATUSES: ApplicationStatus[] = [
  "saved",
  "applied",
  "phone_screen",
  "interview",
  "final_round",
  "offer",
  "rejected",
  "withdrawn",
]

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

function computePipelineStats(applications: JobApplication[]): PipelineStats {
  const by_status = emptyStatusCounts()

  for (const app of applications) {
    if (STATUSES.includes(app.status)) {
      by_status[app.status] = (by_status[app.status] ?? 0) + 1
    }
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
    const firstResponse = timeline.find(
      (entry) => entry.auto && entry.status && !["saved", "applied"].includes(entry.status)
    )
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

async function getApplicationsInitialData(): Promise<ApplicationsInitialData> {
  const fallback: ApplicationsInitialData = {
    initialApplications: [],
    initialStats: null,
    initialLoaded: false,
  }

  const session = await getSessionUser()
  if (!session?.sub) return fallback

  try {
    const pool = getPostgresPool()
    const result = await pool.query<JobApplication & { company_domain: string | null }>(
      `SELECT
         ja.*,
         companies.domain AS company_domain
       FROM job_applications ja
       LEFT JOIN jobs ON jobs.id = ja.job_id
       LEFT JOIN companies ON companies.id = jobs.company_id
       WHERE ja.user_id = $1::uuid
         AND ja.is_archived = false
       ORDER BY ja.updated_at DESC
       LIMIT 500`,
      [session.sub],
    )

    const initialApplications = result.rows.map((row) => {
      const domainFromJob = typeof row.company_domain === "string" ? row.company_domain.trim() : ""
      const fallbackDomain = domainFromApplyUrl(row.apply_url)
      return {
        ...row,
        company_domain: domainFromJob || fallbackDomain || null,
      }
    })

    return {
      initialApplications,
      initialStats: computePipelineStats(initialApplications),
      initialLoaded: true,
    }
  } catch {
    return fallback
  }
}

export default async function ApplicationsPage() {
  const { initialApplications, initialStats, initialLoaded } = await getApplicationsInitialData()

  return (
    <ApplicationsPageClient
      initialApplications={initialApplications}
      initialStats={initialStats}
      initialLoaded={initialLoaded}
    />
  )
}
