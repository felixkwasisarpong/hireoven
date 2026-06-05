import { getSessionUser } from "@/lib/auth/session-user"
import { getPostgresPool } from "@/lib/postgres/server"
import { listRecentSessions, type InterviewSessionWithDebrief } from "@/lib/apex/interview/queries"
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
      fetchRecommendedJobs(user.sub),
      listRecentSessions(user.sub, 5),
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
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">

      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div className="mb-8">
        <div className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-0.5">
          <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
          <span className="text-[11px] font-semibold tracking-wide text-indigo-600">AI-powered practice</span>
        </div>
        <h1 className="text-[26px] font-bold tracking-tight text-slate-900">
          Interview Practice
        </h1>
        <p className="mt-1.5 max-w-xl text-[14px] leading-relaxed text-slate-500">
          Three modes, one debrief. Pick the format that matches your next real interview.
        </p>
      </div>

      {/* Mode cards */}
      <InterviewHubCards />

      {/* Divider */}
      <div className="mt-10 border-t border-slate-100" />

      {/* Recommended + recent */}
      <RecommendedJobsList
        initialJobs={initialData.recommendedJobs}
        initialLoaded={initialData.recommendedJobsLoaded}
      />
      <RecentSessionsList
        initialSessions={initialData.recentSessions}
        initialLoaded={initialData.recentSessionsLoaded}
      />
    </div>
  )
}
