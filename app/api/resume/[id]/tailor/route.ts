import { NextResponse } from "next/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { compareResumeToJob, isUuid } from "@/lib/resume/hub"
import { createClient } from "@/lib/supabase/server"
import type { Resume } from "@/types"

export const runtime = "nodejs"

type TailorBody = {
  jobId?: string
  jobTitle?: string
  company?: string
  jobDescription?: string
  /** When false, compute analysis only (no DB row). Default true. */
  persist?: boolean
}

async function ensureResumeTailoringTable(pool: ReturnType<typeof getPostgresPool>) {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS resume_tailoring_analyses (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
      resume_id UUID REFERENCES resumes(id) ON DELETE CASCADE,
      job_id UUID,
      job_title TEXT,
      company TEXT,
      job_description TEXT NOT NULL,
      match_score INTEGER NOT NULL,
      present_keywords TEXT[],
      missing_keywords TEXT[],
      suggested_summary_rewrite TEXT,
      suggested_skills_to_add TEXT[],
      bullet_suggestions JSONB,
      warnings TEXT[],
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`
  )
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_resume_tailoring_user_resume_created
     ON resume_tailoring_analyses(user_id, resume_id, created_at DESC)`
  )
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const { id } = params
  if (!isUuid(id)) return NextResponse.json({ error: "Invalid resume id" }, { status: 400 })

  const supabase = await createClient()
  const user = (await supabase.auth.getUser()).data.user
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = (await request.json().catch(() => ({}))) as TailorBody
  const shouldPersist = body.persist !== false
  const jobDescription = body.jobDescription?.trim()
  if (!jobDescription) {
    return NextResponse.json({ error: "jobDescription is required" }, { status: 400 })
  }
  if (body.jobId && !isUuid(body.jobId)) {
    return NextResponse.json({ error: "Invalid job id" }, { status: 400 })
  }

  const pool = getPostgresPool()
  await ensureResumeTailoringTable(pool)
  const result = await pool.query<Resume>(
    `SELECT * FROM resumes WHERE id = $1 AND user_id = $2 LIMIT 1`,
    [id, user.id]
  )
  const resume = result.rows[0]
  if (!resume) return NextResponse.json({ error: "Resume not found" }, { status: 404 })

  const analysis = compareResumeToJob(resume, jobDescription, body.jobTitle, body.company)

  if (shouldPersist) {
    await pool.query(
      `INSERT INTO resume_tailoring_analyses (
      user_id,
      resume_id,
      job_id,
      job_title,
      company,
      job_description,
      match_score,
      present_keywords,
      missing_keywords,
      suggested_summary_rewrite,
      suggested_skills_to_add,
      bullet_suggestions,
      warnings
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8::text[], $9::text[],
      $10, $11::text[], $12::jsonb, $13::text[]
    )`,
      [
        user.id,
        resume.id,
        body.jobId ?? null,
        analysis.jobTitle,
        analysis.company,
        jobDescription,
        analysis.matchScore,
        analysis.presentKeywords,
        analysis.missingKeywords,
        analysis.suggestedSummaryRewrite,
        analysis.suggestedSkillsToAdd,
        JSON.stringify(analysis.bulletSuggestions),
        analysis.warnings,
      ]
    )
  }

  return NextResponse.json(analysis)
}
