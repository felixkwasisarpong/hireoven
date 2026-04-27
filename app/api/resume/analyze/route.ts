import { NextResponse } from "next/server"
import { upsertMatchScores } from "@/lib/matching/batch-scorer"
import { mapAnalysisToDeepScore } from "@/lib/matching/deep-scorer"
import { computeFastScore } from "@/lib/matching/fast-scorer"
import { getPostgresPool } from "@/lib/postgres/server"
import { analyzeResumeForJob, getCachedAnalysis } from "@/lib/resume/analyzer"
import { createClient } from "@/lib/supabase/server"
import { requireFeature } from "@/lib/gates/server-gate"
import type { Company, Job, Profile, Resume } from "@/types"

export const runtime = "nodejs"
export const maxDuration = 60

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const resumeId = searchParams.get("resumeId")
  const jobId = searchParams.get("jobId")

  if (!resumeId || !jobId) {
    return NextResponse.json({ error: "resumeId and jobId are required" }, { status: 400 })
  }

  const analysis = await getCachedAnalysis(user.id, resumeId, jobId)
  if (!analysis) return NextResponse.json(null)
  return NextResponse.json(analysis)
}

export async function POST(request: Request) {
  const gate = await requireFeature("deep_analysis")
  if (gate instanceof NextResponse) return gate

  const supabase = await createClient()
  const user = (await supabase.auth.getUser()).data.user
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const pool = getPostgresPool()

  const body = await request.json().catch(() => ({})) as { resumeId?: string; jobId?: string }
  const { resumeId, jobId } = body

  if (!resumeId || !jobId) {
    return NextResponse.json({ error: "resumeId and jobId are required" }, { status: 400 })
  }

  // Verify resume ownership
  const resumeResult = await pool.query<Resume>(
    `SELECT *
     FROM resumes
     WHERE id = $1
       AND user_id = $2
     LIMIT 1`,
    [resumeId, user.id]
  )
  const resumeData = resumeResult.rows[0]

  if (!resumeData) {
    return NextResponse.json({ error: "Resume not found" }, { status: 404 })
  }

  const resume = resumeData as Resume

  if (resume.parse_status !== "complete") {
    return NextResponse.json(
      { error: "Resume must finish parsing before analysis" },
      { status: 400 }
    )
  }

  // Check cache first
  const cached = await getCachedAnalysis(user.id, resumeId, jobId)
  if (cached) return NextResponse.json(cached)

  // Fetch job + company
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

  try {
    const analysis = await analyzeResumeForJob(resume, job, user.id)
    const profileResult = await pool.query<Profile>(
      `SELECT *
       FROM profiles
       WHERE id = $1
       LIMIT 1`,
      [user.id]
    )
    const profileData = profileResult.rows[0]

    if (profileData) {
      const fastScore = computeFastScore({
        resume,
        job,
        profile: profileData as Profile,
      })
      const deepScore = mapAnalysisToDeepScore(
        resume,
        job,
        fastScore,
        analysis
      )
      await upsertMatchScores([deepScore])
    }

    return NextResponse.json(analysis)
  } catch (err) {
    const message = err instanceof Error ? err.message : "Analysis failed"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
