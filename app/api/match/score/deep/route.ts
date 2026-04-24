import { NextResponse } from "next/server"
import { scoreJobsForUser, getScoringContextForUser, upsertMatchScores } from "@/lib/matching/batch-scorer"
import { mapAnalysisToDeepScore } from "@/lib/matching/deep-scorer"
import { getPostgresPool } from "@/lib/postgres/server"
import { analyzeResumeForJob, getCachedAnalysis } from "@/lib/resume/analyzer"
import { createClient } from "@/lib/supabase/server"
import { requireFeature } from "@/lib/gates/server-gate"
import type { Company, Job, JobMatchScore } from "@/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function POST(request: Request) {
  const gate = await requireFeature("deep_analysis")
  if (gate instanceof NextResponse) return gate

  const supabase = await createClient()
  const user = (await supabase.auth.getUser()).data.user!

  const body = (await request.json().catch(() => ({}))) as { jobId?: string }
  const jobId = body.jobId

  if (!jobId) {
    return NextResponse.json({ error: "jobId is required" }, { status: 400 })
  }

  const context = await getScoringContextForUser(user.id)
  if (!context) {
    return NextResponse.json(
      { error: "Primary parsed resume required for deep analysis" },
      { status: 400 }
    )
  }

  const pool = getPostgresPool()
  const jobResult = await pool.query<(Job & { company: Company })>(
    `SELECT jobs.*, to_jsonb(companies.*) AS company
     FROM jobs
     LEFT JOIN companies ON companies.id = jobs.company_id
     WHERE jobs.id = $1
     LIMIT 1`,
    [jobId]
  )
  const jobData = jobResult.rows[0]

  if (!jobData) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 })
  }

  const job = jobData as Job & { company: Company }
  const fastScores = await scoreJobsForUser(user.id, [jobId])
  const fastScore = fastScores.get(jobId)

  if (!fastScore) {
    return NextResponse.json({ error: "Unable to compute fast score" }, { status: 500 })
  }

  const cachedAnalysis =
    (await getCachedAnalysis(user.id, context.resume.id, jobId)) ??
    (await analyzeResumeForJob(context.resume, job, user.id))

  const deepScore = mapAnalysisToDeepScore(context.resume, job, fastScore, cachedAnalysis)
  await upsertMatchScores([deepScore])

  return NextResponse.json({ analysisId: cachedAnalysis.id, scoreMethod: "deep" })
}
