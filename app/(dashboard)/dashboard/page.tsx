import { Suspense } from "react"
import { getSessionUser } from "@/lib/auth/session-user"
import { getPostgresPool } from "@/lib/postgres/server"
import type { WatchlistWithCompany } from "@/types"
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
}

async function getDashboardInitialData(): Promise<DashboardInitialData> {
  const session = await getSessionUser()
  if (!session?.sub) {
    return {
      initialPrimaryResumeReady: false,
      initialWatchlist: [],
      initialWatchlistCount: 0,
    }
  }

  try {
    const pool = getPostgresPool()
    const [resumeResult, watchlistResult] = await Promise.all([
      pool.query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM resumes
           WHERE user_id = $1
             AND is_primary = true
             AND parse_status = 'complete'
         ) AS exists`,
        [session.sub]
      ),
      pool.query<WatchlistWithCompany & { total_count: string }>(
        `SELECT w.*, to_jsonb(c.*) AS company, COUNT(*) OVER() AS total_count
         FROM watchlist w
         JOIN companies c ON c.id = w.company_id
         WHERE w.user_id = $1
         ORDER BY w.created_at DESC
         LIMIT 5`,
        [session.sub]
      ),
    ])

    const initialWatchlist = watchlistResult.rows.map(({ total_count, ...item }) => item)
    return {
      initialPrimaryResumeReady: Boolean(resumeResult.rows[0]?.exists),
      initialWatchlist,
      initialWatchlistCount: Number(watchlistResult.rows[0]?.total_count ?? initialWatchlist.length),
    }
  } catch {
    return {
      initialPrimaryResumeReady: false,
      initialWatchlist: [],
      initialWatchlistCount: 0,
    }
  }
}

export default async function DashboardPage() {
  const { initialPrimaryResumeReady, initialWatchlist, initialWatchlistCount } =
    await getDashboardInitialData()
  return (
    <Suspense fallback={<DashboardHomeFallback />}>
      <DashboardHomeClient
        initialPrimaryResumeReady={initialPrimaryResumeReady}
        initialWatchlist={initialWatchlist}
        initialWatchlistCount={initialWatchlistCount}
      />
    </Suspense>
  )
}
