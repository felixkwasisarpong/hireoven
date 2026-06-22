import { getSessionUser } from "@/lib/auth/session-user"
import { getPostgresPool } from "@/lib/postgres/server"
import { listRecentSessions, type InterviewSessionWithDebrief } from "@/lib/apex/interview/queries"
import Link from "next/link"
import { History } from "lucide-react"
import InterviewHubCards from "@/components/interview/InterviewHubCards"
import RecommendedJobsList from "@/components/interview/RecommendedJobsList"
import RecentSessionsList from "@/components/interview/RecentSessionsList"

export const dynamic = "force-dynamic"

type RecommendedJob = {
  id: string
  title: string
  company: string
  savedAt: string
}

type RecentSession = {
  id: string
  type: string
  persona: string
  status: string
  jobTitle: string | null
  jobCompany: string | null
  createdAt: string
  debrief: { overallScore: number | null } | null
}

type HubInitialData = {
  recommendedJobs: RecommendedJob[]
  recommendedJobsLoaded: boolean
  recentSessions: RecentSession[]
  recentSessionsLoaded: boolean
}

function serializeRecentSessions(sessions: InterviewSessionWithDebrief[]): RecentSession[] {
  return sessions.map((session) => ({
    id: session.id,
    type: session.type,
    persona: session.persona,
    status: session.status,
    jobTitle: session.jobTitle,
    jobCompany: session.jobCompany,
    createdAt: session.createdAt.toISOString(),
    debrief: session.debrief ? { overallScore: session.debrief.overallScore } : null,
  }))
}

async function fetchRecommendedJobs(userId: string): Promise<RecommendedJob[]> {
  const pool = getPostgresPool()
  const result = await pool.query<{
    id: string
    title: string
    company: string
    saved_at: string
  }>(
    `SELECT * FROM (
       SELECT DISTINCT ON (ja.job_id)
         ja.job_id AS id,
         ja.job_title AS title,
         ja.company_name AS company,
         ja.created_at AS saved_at
       FROM job_applications ja
       WHERE ja.user_id = $1
         AND ja.status NOT IN ('rejected', 'withdrawn')
         AND ja.is_archived = false
         AND ja.job_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM interview_sessions s
           WHERE s.user_id = $1
             AND s.job_id = ja.job_id
             AND s.status = 'completed'
         )
       ORDER BY ja.job_id, ja.created_at DESC
     ) sub
     ORDER BY saved_at DESC
     LIMIT 3`,
    [userId],
  )

  return result.rows.map((row) => ({
    id: row.id,
    title: row.title,
    company: row.company,
    savedAt: row.saved_at,
  }))
}

/**
 * Bound a server-side preload so a slow/restarting Postgres can't hang the SSR
 * request. The pool only has a connection-acquire timeout, not a query timeout,
 * so a query that stalls mid-flight would otherwise hang until the gateway 502s.
 * On timeout we reject — Promise.allSettled below treats that as "not loaded"
 * and the client components fetch the data themselves (initialLoaded=false).
 */
const PRELOAD_TIMEOUT_MS = 3_000
function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      const t = setTimeout(
        () => reject(new Error(`${label} preload timed out after ${PRELOAD_TIMEOUT_MS}ms`)),
        PRELOAD_TIMEOUT_MS,
      )
      t.unref?.()
    }),
  ])
}

async function getHubInitialData(): Promise<HubInitialData> {
  const fallback: HubInitialData = {
    recommendedJobs: [],
    recommendedJobsLoaded: false,
    recentSessions: [],
    recentSessionsLoaded: false,
  }

  try {
    const user = await getSessionUser()
    if (!user?.sub) {
      return {
        recommendedJobs: [],
        recommendedJobsLoaded: true,
        recentSessions: [],
        recentSessionsLoaded: true,
      }
    }

    const [recommendedResult, recentSessionsResult] = await Promise.allSettled([
      withTimeout(fetchRecommendedJobs(user.sub), "recommendedJobs"),
      withTimeout(listRecentSessions(user.sub, 5), "recentSessions"),
    ])

    return {
      recommendedJobs:
        recommendedResult.status === "fulfilled" ? recommendedResult.value : fallback.recommendedJobs,
      recommendedJobsLoaded: recommendedResult.status === "fulfilled",
      recentSessions:
        recentSessionsResult.status === "fulfilled"
          ? serializeRecentSessions(recentSessionsResult.value)
          : fallback.recentSessions,
      recentSessionsLoaded: recentSessionsResult.status === "fulfilled",
    }
  } catch {
    return fallback
  }
}

export default async function InterviewHubPage() {
  const initialData = await getHubInitialData()

  return (
    <main className="min-h-full bg-[#fbfcfd]">
      <div className="mx-auto w-full max-w-[1260px] px-4 py-8 sm:px-6 lg:px-11 lg:py-[38px]">
        <div className="mb-[30px] flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="mb-2.5 text-[11.5px] font-bold uppercase tracking-[0.16em] text-[#ec6516]">
              Grow · Interview Practice
            </p>
            <h1 className="m-0 text-[34px] font-extrabold leading-[1.02] tracking-[-0.03em] text-[#0d1424] sm:text-[40px]">
              Step into the room.
            </h1>
            <p className="mt-3 max-w-[540px] text-[16px] leading-[1.6] text-[#5b6573]">
              Pick a practice mode, run a focused session, and walk away with a debrief built for your next real interview.
            </p>
          </div>
          <Link
            href="/dashboard/interview/history"
            className="inline-flex h-11 w-fit shrink-0 items-center gap-2 rounded-xl border border-[#e7eaf0] bg-white px-[18px] text-[13.5px] font-semibold text-[#3f4856] shadow-[0_1px_2px_rgba(15,23,42,.03)] transition hover:border-[#d6dbe4] hover:bg-[#f9fafb] active:translate-y-px"
          >
            <History className="h-[15px] w-[15px] text-[#9aa3b1]" strokeWidth={2} aria-hidden />
            Session history
          </Link>
        </div>

        <div className="mb-[34px]">
          <InterviewHubCards />
        </div>

        <div className="grid gap-[22px] lg:grid-cols-2">
          <RecommendedJobsList
            className="mt-0"
            initialJobs={initialData.recommendedJobs}
            initialLoaded={initialData.recommendedJobsLoaded}
          />
          <RecentSessionsList
            className="mt-0"
            initialSessions={initialData.recentSessions}
            initialLoaded={initialData.recentSessionsLoaded}
          />
        </div>
      </div>
    </main>
  )
}
