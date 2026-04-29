import { NextResponse } from "next/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { createClient } from "@/lib/supabase/server"
import type { Resume } from "@/types"

export const runtime = "nodejs"

async function ensureResumeLifecycleColumns() {
  const pool = getPostgresPool()
  await pool.query(
    `ALTER TABLE resumes
       ADD COLUMN IF NOT EXISTS file_type TEXT,
       ADD COLUMN IF NOT EXISTS parse_error TEXT,
       ADD COLUMN IF NOT EXISTS github_url TEXT,
       ADD COLUMN IF NOT EXISTS certifications JSONB,
       ADD COLUMN IF NOT EXISTS ats_score INTEGER,
       ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
       ADD COLUMN IF NOT EXISTS raw_text TEXT,
       ADD COLUMN IF NOT EXISTS top_skills JSONB,
       ADD COLUMN IF NOT EXISTS years_of_experience NUMERIC,
       ADD COLUMN IF NOT EXISTS resume_score INTEGER,
       ADD COLUMN IF NOT EXISTS primary_role TEXT,
       ADD COLUMN IF NOT EXISTS seniority_level TEXT,
       ADD COLUMN IF NOT EXISTS industries JSONB`
  )
}

export async function POST(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  await ensureResumeLifecycleColumns()
  const pool = getPostgresPool()
  const current = await pool.query<Resume>(
    `SELECT *
     FROM resumes
     WHERE id = $1
       AND user_id = $2
     LIMIT 1`,
    [params.id, user.id]
  )
  const resume = current.rows[0]

  if (!resume) {
    return NextResponse.json({ error: "Resume not found" }, { status: 404 })
  }

  const result = await pool.query<Resume>(
    `INSERT INTO resumes (
      user_id,
      file_name,
      name,
      file_url,
      storage_path,
      file_size,
      file_type,
      is_primary,
      parse_status,
      parse_error,
      full_name,
      email,
      phone,
      location,
      linkedin_url,
      portfolio_url,
      github_url,
      summary,
      work_experience,
      education,
      skills,
      projects,
      certifications,
      seniority_level,
      years_of_experience,
      primary_role,
      industries,
      top_skills,
      resume_score,
      ats_score,
      raw_text,
      archived_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, false,
      $8, $9, $10, $11, $12, $13, $14, $15,
      $16, $17, $18::jsonb, $19::jsonb, $20::jsonb,
      $21::jsonb, $22::jsonb, $23, $24, $25,
      $26::text[], $27::text[], $28, $29, $30, NULL
    )
    RETURNING *`,
    [
      user.id,
      resume.file_name,
      `${resume.name ?? resume.file_name} copy`,
      resume.file_url,
      resume.storage_path,
      resume.file_size,
      resume.file_type ?? null,
      resume.parse_status,
      resume.parse_error ?? null,
      resume.full_name,
      resume.email,
      resume.phone,
      resume.location,
      resume.linkedin_url,
      resume.portfolio_url,
      resume.github_url ?? null,
      resume.summary,
      JSON.stringify(resume.work_experience ?? null),
      JSON.stringify(resume.education ?? null),
      JSON.stringify(resume.skills ?? null),
      JSON.stringify(resume.projects ?? null),
      JSON.stringify(resume.certifications ?? null),
      resume.seniority_level,
      resume.years_of_experience,
      resume.primary_role,
      resume.industries ?? [],
      resume.top_skills ?? [],
      resume.resume_score,
      resume.ats_score ?? null,
      resume.raw_text,
    ]
  )

  return NextResponse.json({ resume: result.rows[0] })
}
