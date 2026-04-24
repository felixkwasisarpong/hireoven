import { NextResponse } from "next/server"
import { generateCoverLetter } from "@/lib/resume/cover-letter-generator"
import { getPostgresPool } from "@/lib/postgres/server"
import { createClient } from "@/lib/supabase/server"
import { requireFeature } from "@/lib/gates/server-gate"
import type { CoverLetter, CoverLetterOptions, Company, Job, Resume } from "@/types"

export const runtime = "nodejs"
export const maxDuration = 120

export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const jobId = searchParams.get("jobId")
  const pool = getPostgresPool()

  if (!jobId) {
    const result = await pool.query<CoverLetter>(
      `SELECT *
       FROM cover_letters
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [user.id]
    )
    return NextResponse.json({ coverLetters: result.rows })
  }

  const result = await pool.query<CoverLetter>(
    `SELECT *
     FROM cover_letters
     WHERE user_id = $1
       AND job_id = $2
     ORDER BY created_at DESC
     LIMIT 1`,
    [user.id, jobId]
  )
  const data = result.rows[0] ?? null

  return NextResponse.json(data)
}

export async function POST(request: Request) {
  const gate = await requireFeature("cover_letter")
  if (gate instanceof NextResponse) return gate

  const supabase = await createClient()
  const user = (await supabase.auth.getUser()).data.user!
  const pool = getPostgresPool()

  const body = await request.json().catch(() => ({})) as {
    resumeId?: string
    jobId?: string
    options?: CoverLetterOptions
  }
  const { resumeId, jobId, options } = body

  if (!jobId) return NextResponse.json({ error: "jobId is required" }, { status: 400 })
  if (!options) return NextResponse.json({ error: "options are required" }, { status: 400 })

  // Resolve resume: use provided ID or fall back to primary
  let resume: Resume | null = null
  if (resumeId) {
    const resumeResult = await pool.query<Resume>(
      `SELECT *
       FROM resumes
       WHERE id = $1
         AND user_id = $2
       LIMIT 1`,
      [resumeId, user.id]
    )
    resume = resumeResult.rows[0] ?? null
  } else {
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
    resume = resumeResult.rows[0] ?? null
  }

  if (!resume) {
    return NextResponse.json(
      { error: "No parsed resume found. Upload and parse a resume first." },
      { status: 400 }
    )
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

  const job = jobData as Job & { company: Company }

  try {
    const coverLetter = await generateCoverLetter(resume, job, options, user.id)
    return NextResponse.json(coverLetter)
  } catch (err) {
    const message = err instanceof Error ? err.message : "Generation failed"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
