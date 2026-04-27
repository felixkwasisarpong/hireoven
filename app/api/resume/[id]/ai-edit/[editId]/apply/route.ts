import { NextResponse } from "next/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { applyAiEditPatch, isUuid } from "@/lib/resume/hub"
import { createClient } from "@/lib/supabase/server"
import type { Resume, ResumeAiEditRecord } from "@/types"
import type { ResumeAiEditPatch } from "@/lib/resume/hub"

export const runtime = "nodejs"

export async function POST(
  _request: Request,
  { params }: { params: { id: string; editId: string } }
) {
  const { id, editId } = params
  if (!isUuid(id) || !isUuid(editId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 })
  }

  const supabase = await createClient()
  const user = (await supabase.auth.getUser()).data.user
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const pool = getPostgresPool()
  const [resumeResult, editResult] = await Promise.all([
    pool.query<Resume>(
      `SELECT * FROM resumes WHERE id = $1 AND user_id = $2 LIMIT 1`,
      [id, user.id]
    ),
    pool.query<ResumeAiEditRecord>(
      `SELECT * FROM resume_ai_edits
       WHERE id = $1 AND resume_id = $2 AND user_id = $3
       LIMIT 1`,
      [editId, id, user.id]
    ),
  ])

  const resume = resumeResult.rows[0]
  const edit = editResult.rows[0]
  if (!resume) return NextResponse.json({ error: "Resume not found" }, { status: 404 })
  if (!edit) return NextResponse.json({ error: "Edit not found" }, { status: 404 })
  if (!edit.output_patch) return NextResponse.json({ error: "Edit has no patch" }, { status: 400 })

  const nextResume = applyAiEditPatch(resume, edit.output_patch as ResumeAiEditPatch)
  const update = await pool.query<Resume>(
    `UPDATE resumes
     SET
       summary = $1,
       work_experience = $2::jsonb,
       skills = $3::jsonb,
       top_skills = $4::text[],
       years_of_experience = $5,
       primary_role = $6,
       resume_score = $7,
       ats_score = $8,
       raw_text = $9,
       updated_at = now()
     WHERE id = $10 AND user_id = $11
     RETURNING *`,
    [
      nextResume.summary,
      JSON.stringify(nextResume.work_experience ?? null),
      JSON.stringify(nextResume.skills ?? null),
      nextResume.top_skills ?? [],
      nextResume.years_of_experience,
      nextResume.primary_role,
      nextResume.resume_score,
      nextResume.ats_score ?? null,
      nextResume.raw_text,
      id,
      user.id,
    ]
  )

  return NextResponse.json({ resume: update.rows[0], edit })
}
