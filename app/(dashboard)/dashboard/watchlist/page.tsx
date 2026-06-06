import { getSessionUser } from "@/lib/auth/session-user"
import { sqlPublishedJob } from "@/lib/jobs/publication"
import { getPostgresPool } from "@/lib/postgres/server"
import { listWatchlistWithCompany } from "@/lib/watchlist/store"
import type { Company, WatchlistWithCompany } from "@/types"
import WatchlistPageClient from "./WatchlistPageClient"

export const dynamic = "force-dynamic"

type CompanyInsights = {
  newJobsThisWeek: number
  latestJobTitle: string | null
  latestJobDetectedAt: string | null
}

type WatchlistInitialData = {
  initialWatchlist: WatchlistWithCompany[]
  initialWatchlistLoaded: boolean
  initialDiscoverCompanies: Company[]
  initialDiscoverLoaded: boolean
  initialInsights: Record<string, CompanyInsights>
  initialInsightsLoaded: boolean
}

type WatchlistInsightRow = {
  company_id: string
  new_jobs_this_week: number
  latest_job_title: string | null
  latest_job_detected_at: string | null
}

async function fetchDiscoverCompanies(limit: number): Promise<Company[]> {
  const pool = getPostgresPool()
  const result = await pool.query<Company>(
    `SELECT companies.*
     FROM companies
     WHERE companies.is_active = true
       AND companies.job_count > 0
     ORDER BY companies.job_count DESC NULLS LAST
     LIMIT $1`,
    [limit],
  )
  return result.rows
}

async function fetchWatchlistInsights(userId: string): Promise<Record<string, CompanyInsights>> {
  const pool = getPostgresPool()
  const cutoff = new Date(Date.now() - 7 * 86_400_000).toISOString()
  const result = await pool.query<WatchlistInsightRow>(
    `SELECT
       w.company_id,
       COALESCE(stats.new_jobs_this_week, 0)::int AS new_jobs_this_week,
       latest.latest_job_title,
       latest.latest_job_detected_at
     FROM watchlist w
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS new_jobs_this_week
       FROM jobs j
       WHERE j.company_id = w.company_id
         AND j.is_active = true
         AND ${sqlPublishedJob("j")}
         AND j.first_detected_at >= $2::timestamptz
     ) AS stats ON true
     LEFT JOIN LATERAL (
       SELECT
         j.title AS latest_job_title,
         j.first_detected_at AS latest_job_detected_at
       FROM jobs j
       WHERE j.company_id = w.company_id
         AND j.is_active = true
         AND ${sqlPublishedJob("j")}
         AND j.first_detected_at >= $2::timestamptz
       ORDER BY j.first_detected_at DESC NULLS LAST
       LIMIT 1
     ) AS latest ON true
     WHERE w.user_id = $1::uuid`,
    [userId, cutoff],
  )

  return Object.fromEntries(
    result.rows.map((row) => [
      row.company_id,
      {
        newJobsThisWeek: row.new_jobs_this_week ?? 0,
        latestJobTitle: row.latest_job_title ?? null,
        latestJobDetectedAt: row.latest_job_detected_at ?? null,
      },
    ]),
  )
}

async function getWatchlistInitialData(userId: string | null): Promise<WatchlistInitialData> {
  const fallback: WatchlistInitialData = {
    initialWatchlist: [],
    initialWatchlistLoaded: false,
    initialDiscoverCompanies: [],
    initialDiscoverLoaded: false,
    initialInsights: {},
    initialInsightsLoaded: false,
  }

  try {
    if (!userId) {
      const discover = await fetchDiscoverCompanies(8)
      return {
        initialWatchlist: [],
        initialWatchlistLoaded: true,
        initialDiscoverCompanies: discover,
        initialDiscoverLoaded: true,
        initialInsights: {},
        initialInsightsLoaded: true,
      }
    }

    const pool = getPostgresPool()
    const [watchlistResult, discoverResult, insightsResult] = await Promise.allSettled([
      listWatchlistWithCompany({ db: pool, userId }),
      fetchDiscoverCompanies(8),
      fetchWatchlistInsights(userId),
    ])

    return {
      initialWatchlist:
        watchlistResult.status === "fulfilled" ? watchlistResult.value.rows : fallback.initialWatchlist,
      initialWatchlistLoaded: watchlistResult.status === "fulfilled",
      initialDiscoverCompanies:
        discoverResult.status === "fulfilled"
          ? discoverResult.value
          : fallback.initialDiscoverCompanies,
      initialDiscoverLoaded: discoverResult.status === "fulfilled",
      initialInsights:
        insightsResult.status === "fulfilled" ? insightsResult.value : fallback.initialInsights,
      initialInsightsLoaded: insightsResult.status === "fulfilled",
    }
  } catch {
    return fallback
  }
}

export default async function WatchlistPage() {
  const sessionUser = await getSessionUser()
  const initialData = await getWatchlistInitialData(sessionUser?.sub ?? null)

  return <WatchlistPageClient {...initialData} />
}
