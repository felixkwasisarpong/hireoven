import { Suspense } from "react"
import { redirect } from "next/navigation"
import { getSessionUser } from "@/lib/auth/session-user"
import { getPostgresPool } from "@/lib/postgres/server"
import type { WatchlistWithCompany } from "@/types"
import { listWatchlistWithCompany } from "@/lib/watchlist/store"
import DashboardHomeClient from "./DashboardHomeClient"

function DashboardHomeFallback() {
  return (
    <main className="app-page min-h-screen animate-pulse xl:flex xl:h-[100dvh] xl:flex-col xl:overflow-hidden">
      <div className="h-[52px] border-b border-border bg-surface/60 md:h-[57px]" />
      <div className="app-shell mx-auto flex w-full max-w-[1680px] flex-1 flex-col gap-6 px-4 py-4 lg:flex-row lg:px-6 xl:mx-0 xl:max-w-none xl:px-0 xl:py-0">
        <div className="hidden h-[70vh] max-h-[640px] w-full max-w-[240px] rounded-xl bg-surface-muted/90 lg:block" />
        <div className="min-h-[50vh] flex-1 rounded-lg bg-surface-muted/70 xl:min-h-0" />
        <div className="hidden w-[312px] bg-surface-muted/50 xl:block" />
      </div>
    </main>
  )
}

/**
 * Pre-resolves the user's primary-resume status server-side so the client doesn't have to
 * wait for `/api/auth/session` → `/api/resume` round-trips before it knows whether to
 * request match scores. Eliminates the double-fetch on refresh.
 */
type DashboardInitialData = {
  initialPrimaryResumeReady: boolean
  initialWatchlist: WatchlistWithCompany[]
  initialWatchlistCount: number
  /** Jobs first seen (or created) today (UTC calendar day), keyed by company id */
  initialJobsTodayByCompanyId: Record<string, number>
}

async function getDashboardInitialData(): Promise<DashboardInitialData> {
  const session = await getSessionUser()
  if (!session?.sub) {
    return {
      initialPrimaryResumeReady: false,
      initialWatchlist: [],
      initialWatchlistCount: 0,
      initialJobsTodayByCompanyId: {},
    }
  }

  try {
    const pool = getPostgresPool()
    const [resumeResult, watchlist] = await Promise.all([
      pool.query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM resumes
           WHERE user_id = $1
             AND is_primary = true
             AND parse_status = 'complete'
         ) AS exists`,
        [session.sub]
      ),
      listWatchlistWithCompany({ db: pool, userId: session.sub, limit: 5 }),
    ])

    const initialWatchlist = watchlist.rows
    const companyIds = [
      ...new Set(
        initialWatchlist.map((w) => w.company?.id).filter((id): id is string => Boolean(id)),
      ),
    ]

    let initialJobsTodayByCompanyId: Record<string, number> = {}
    if (companyIds.length > 0) {
      try {
        const todayCounts = await pool.query<{ company_id: string; n: number }>(
          `SELECT company_id::text AS company_id, COUNT(*)::int AS n
           FROM jobs
           WHERE company_id = ANY($1::uuid[])
             AND COALESCE(is_active, true) = true
             AND COALESCE(first_detected_at, created_at)::date = CURRENT_DATE
           GROUP BY company_id`,
          [companyIds]
        )
        initialJobsTodayByCompanyId = Object.fromEntries(
          todayCounts.rows.map((r) => [r.company_id, r.n]),
        )
      } catch {
        initialJobsTodayByCompanyId = {}
      }
    }

    return {
      initialPrimaryResumeReady: Boolean(resumeResult.rows[0]?.exists),
      initialWatchlist,
      initialWatchlistCount: watchlist.totalCount,
      initialJobsTodayByCompanyId,
    }
  } catch {
    return {
      initialPrimaryResumeReady: false,
      initialWatchlist: [],
      initialWatchlistCount: 0,
      initialJobsTodayByCompanyId: {},
    }
  }
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const hasParams = Object.keys(params).length > 0

  if (!hasParams) {
    const session = await getSessionUser()
    let saved: string | null = null
    if (session?.sub) {
      try {
        const pool = getPostgresPool()
        const result = await pool.query<{ default_feed_filters: string | null }>(
          `SELECT default_feed_filters FROM profiles WHERE id = $1 LIMIT 1`,
          [session.sub]
        )
        saved = result.rows[0]?.default_feed_filters?.trim() || null
      } catch {
        saved = null
      }
    }
    if (saved) redirect(`/dashboard?${saved}`)
  }

  const {
    initialPrimaryResumeReady,
    initialWatchlist,
    initialWatchlistCount,
    initialJobsTodayByCompanyId,
  } = await getDashboardInitialData()
  return (
    <Suspense fallback={<DashboardHomeFallback />}>
      <DashboardHomeClient
        initialPrimaryResumeReady={initialPrimaryResumeReady}
        initialWatchlist={initialWatchlist}
        initialWatchlistCount={initialWatchlistCount}
        initialJobsTodayByCompanyId={initialJobsTodayByCompanyId}
      />
    </Suspense>
  )
}
