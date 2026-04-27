import { NextResponse } from "next/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { isUuid, restoreResumeFromSnapshot } from "@/lib/resume/hub"
import { createClient } from "@/lib/supabase/server"
import type { Resume, ResumeVersion } from "@/types"

export const runtime = "nodejs"

export async function POST(
  _request: Request,
  { params }: { params: { id: string; versionId: string } }
) {
  const { id, versionId } = params
  if (!isUuid(id) || !isUuid(versionId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 })
  }

  const supabase = await createClient()
  const user = (await supabase.auth.getUser()).data.user
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const pool = getPostgresPool()
  const [resumeResult, versionResult] = await Promise.all([
    pool.query<Resume>(
      `SELECT * FROM resumes WHERE id = $1 AND user_id = $2 LIMIT 1`,
      [id, user.id]
    ),
    pool.query<ResumeVersion>(
      `SELECT * FROM resume_versions
       WHERE id = $1 AND resume_id = $2 AND user_id = $3
       LIMIT 1`,
      [versionId, id, user.id]
    ),
  ])
  const resume = resumeResult.rows[0]
  const version = versionResult.rows[0]
  if (!resume) return NextResponse.json({ error: "Resume not found" }, { status: 404 })
  if (!version) return NextResponse.json({ error: "Version not found" }, { status: 404 })
  if (!version.snapshot) return NextResponse.json({ error: "Version has no snapshot" }, { status: 400 })

  const restored = restoreResumeFromSnapshot(resume, version.snapshot)
  const update = await pool.query<Resume>(
    `UPDATE resumes
     SET
       full_name = $1,
       email = $2,
       phone = $3,
       location = $4,
       linkedin_url = $5,
       portfolio_url = $6,
       github_url = $7,
       summary = $8,
       work_experience = $9::jsonb,
       education = $10::jsonb,
       skills = $11::jsonb,
       projects = $12::jsonb,
       certifications = $13::jsonb,
       seniority_level = $14,
       years_of_experience = $15,
       primary_role = $16,
       industries = $17::text[],
       top_skills = $18::text[],
       resume_score = $19,
       ats_score = $20,
       raw_text = $21,
       updated_at = now()
     WHERE id = $22 AND user_id = $23
     RETURNING *`,
    [
      restored.full_name,
      restored.email,
      restored.phone,
      restored.location,
      restored.linkedin_url,
      restored.portfolio_url,
      restored.github_url ?? null,
      restored.summary,
      JSON.stringify(restored.work_experience ?? null),
      JSON.stringify(restored.education ?? null),
      JSON.stringify(restored.skills ?? null),
      JSON.stringify(restored.projects ?? null),
      JSON.stringify(restored.certifications ?? null),
      restored.seniority_level,
      restored.years_of_experience,
      restored.primary_role,
      restored.industries ?? [],
      restored.top_skills ?? [],
      restored.resume_score,
      restored.ats_score ?? null,
      restored.raw_text,
      id,
      user.id,
    ]
  )

  return NextResponse.json({ resume: update.rows[0], version })
}
