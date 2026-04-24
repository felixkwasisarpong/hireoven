import { NextResponse } from "next/server"
import { generateVariants } from "@/lib/resume/cover-letter-generator"
import { getPostgresPool } from "@/lib/postgres/server"
import { createClient } from "@/lib/supabase/server"
import type { CoverLetterOptions, Company, Job, Resume } from "@/types"

export const runtime = "nodejs"
export const maxDuration = 120

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const pool = getPostgresPool()

  const body = await request.json().catch(() => ({})) as {
    jobId?: string
    options?: CoverLetterOptions
  }
  const { jobId, options } = body

  if (!jobId || !options) {
    return NextResponse.json({ error: "jobId and options are required" }, { status: 400 })
  }

  const resumeResult = await pool.query<Resume>(
    `SELECT *
     FROM resumes
     WHERE user_id = $1
       AND is_primary = true
       AND parse_status = 'complete'
     ORDER BY updated_at DESC
     LIMIT 1`,
    [user.id]
  )
  const resumeData = resumeResult.rows[0]

  if (!resumeData) {
    return NextResponse.json({ error: "No parsed resume found" }, { status: 400 })
  }

  const jobResult = await pool.query<(Job & { company: Company })>(
    `SELECT jobs.*, to_jsonb(companies.*) AS company
     FROM jobs
     LEFT JOIN companies ON companies.id = jobs.company_id
     WHERE jobs.id = $1
     LIMIT 1`,
    [jobId]
  )
  const jobData = jobResult.rows[0]

  if (!jobData) return NextResponse.json({ error: "Job not found" }, { status: 404 })

  try {
    const variants = await generateVariants(
      resumeData as Resume,
      jobData as Job & { company: Company },
      options,
      user.id,
      3
    )
    return NextResponse.json(variants)
  } catch (err) {
    const message = err instanceof Error ? err.message : "Variants generation failed"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
