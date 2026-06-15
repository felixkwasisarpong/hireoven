import { getSessionUser } from "@/lib/auth/session-user"
import { getPostgresPool } from "@/lib/postgres/server"
import { listRecentSessions, type InterviewSessionWithDebrief } from "@/lib/apex/interview/queries"
import Link from "next/link"
import { ArrowRight, Mic } from "lucide-react"
import GrowPageShell from "@/components/grow/GrowPageShell"
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
    <GrowPageShell
      kicker="Grow"
      title="Interview Practice"
      description="Choose text, live voice, or coding practice, then turn each session into a focused debrief for your next real interview."
      icon={Mic}
      signals={[
        { label: "Modes", value: "Text, live, coding" },
        { label: "Output", value: "Debriefs" },
        { label: "Context", value: "Saved jobs" },
      ]}
    >
      <div className="space-y-5">
        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-5">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-orange-600">
                Practice modes
              </p>
              <h2 className="mt-1 text-base font-semibold text-slate-950">Start a session</h2>
            </div>
            <Link
              href="/dashboard/interview/history"
              className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] font-semibold text-slate-700 transition hover:bg-slate-50 hover:text-slate-950"
            >
              Session history
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </div>

          <InterviewHubCards />
        </section>

        <div className="grid gap-5 lg:grid-cols-2">
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
    </GrowPageShell>
  )
}
