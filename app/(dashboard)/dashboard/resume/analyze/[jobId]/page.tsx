import { getSessionUser } from "@/lib/auth/session-user"
import { sqlJobLocatedInUsa } from "@/lib/jobs/usa-job-sql"
import { getPostgresPool } from "@/lib/postgres/server"
import { getCachedAnalysis } from "@/lib/resume/analyzer"
import type { Company, Job, ResumeAnalysis } from "@/types"
import AnalyzePageClient from "./AnalyzePageClient"

export const dynamic = "force-dynamic"

type JobWithCompany = Job & { company: Company }

type AnalyzeInitialData = {
  initialJob: JobWithCompany | null
  initialJobLoaded: boolean
  initialResumeId: string | null
  initialAnalysis: ResumeAnalysis | null
  initialAnalysisResolvedKey: string | null
}

async function getAnalyzeInitialData(jobId: string): Promise<AnalyzeInitialData> {
  const fallback: AnalyzeInitialData = {
    initialJob: null,
    initialJobLoaded: false,
    initialResumeId: null,
    initialAnalysis: null,
    initialAnalysisResolvedKey: null,
  }

  try {
    const session = await getSessionUser()
    const pool = getPostgresPool()

    const [jobResult, resumeResult] = await Promise.all([
      pool.query<JobWithCompany>(
        `SELECT j.*, to_jsonb(c.*) AS company
         FROM jobs j
         LEFT JOIN companies c ON c.id = j.company_id
         WHERE j.id = $1 AND ${sqlJobLocatedInUsa("j")}
         LIMIT 1`,
        [jobId],
      ),
      session?.sub
        ? pool.query<{ id: string }>(
            `SELECT id
             FROM resumes
             WHERE user_id = $1::uuid
               AND is_primary = true
               AND parse_status = 'complete'
             LIMIT 1`,
            [session.sub],
          )
        : Promise.resolve({ rows: [] } as { rows: Array<{ id: string }> }),
    ])

    const initialJob = jobResult.rows[0] ?? null
    const initialResumeId = resumeResult.rows[0]?.id ?? null

    if (!session?.sub || !initialResumeId) {
      return {
        initialJob,
        initialJobLoaded: true,
        initialResumeId,
        initialAnalysis: null,
        initialAnalysisResolvedKey: null,
      }
    }

    const initialAnalysis = await getCachedAnalysis(session.sub, initialResumeId, jobId)
    const initialAnalysisResolvedKey = `${initialResumeId}:${jobId}`

    return {
      initialJob,
      initialJobLoaded: true,
      initialResumeId,
      initialAnalysis,
      initialAnalysisResolvedKey,
    }
  } catch {
    return fallback
  }
}

export default async function AnalyzePage({
  params,
}: {
  params: Promise<{ jobId: string }>
}) {
  const { jobId } = await params
  const initialData = await getAnalyzeInitialData(jobId)

  return (
    <AnalyzePageClient
      jobId={jobId}
      initialJob={initialData.initialJob}
      initialJobLoaded={initialData.initialJobLoaded}
      initialResumeId={initialData.initialResumeId}
      initialAnalysis={initialData.initialAnalysis}
      initialAnalysisResolvedKey={initialData.initialAnalysisResolvedKey}
    />
  )
}
