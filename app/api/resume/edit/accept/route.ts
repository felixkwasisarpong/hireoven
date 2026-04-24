import { NextResponse } from "next/server"
import { applyResumeEditContent } from "@/lib/resume/state"
import { getPostgresPool } from "@/lib/postgres/server"
import { getResumeUrl } from "@/lib/supabase/storage"
import { createClient } from "@/lib/supabase/server"
import type { Resume, ResumeEdit, ResumeEditContext, ResumeSection } from "@/types"

export const runtime = "nodejs"

type AcceptBody = {
  editId?: string
  section?: ResumeSection
  content?: unknown
  context?: ResumeEditContext | null
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const pool = getPostgresPool()

  const body = (await request.json().catch(() => ({}))) as AcceptBody
  if (!body.editId || !body.section) {
    return NextResponse.json({ error: "editId and section are required" }, { status: 400 })
  }

  const editResult = await pool.query<ResumeEdit>(
    `SELECT *
     FROM resume_edits
     WHERE id = $1
       AND user_id = $2
     LIMIT 1`,
    [body.editId, user.id]
  )
  const editData = editResult.rows[0]

  if (!editData) {
    return NextResponse.json({ error: "Edit not found" }, { status: 404 })
  }

  const edit = editData as ResumeEdit
  const resumeResult = await pool.query<Resume>(
    `SELECT *
     FROM resumes
     WHERE id = $1
       AND user_id = $2
     LIMIT 1`,
    [edit.resume_id, user.id]
  )
  const resumeData = resumeResult.rows[0]

  if (!resumeData) {
    return NextResponse.json({ error: "Resume not found" }, { status: 404 })
  }

  const resume = resumeData as Resume
  const nextResume = applyResumeEditContent(
    resume,
    body.section,
    body.content ?? edit.suggested_content,
    body.context ?? edit.context
  )

  const updates = {
    summary: nextResume.summary,
    work_experience: nextResume.work_experience,
    education: nextResume.education,
    skills: nextResume.skills,
    projects: nextResume.projects,
    years_of_experience: nextResume.years_of_experience,
    primary_role: nextResume.primary_role,
    top_skills: nextResume.top_skills,
    resume_score: nextResume.resume_score,
    raw_text: nextResume.raw_text,
  }

  const [{ rows: updatedRows }, markResult] = await Promise.all([
    pool.query<Resume>(
      `UPDATE resumes
       SET
         summary = $1,
         work_experience = $2::jsonb,
         education = $3::jsonb,
         skills = $4::jsonb,
         projects = $5::jsonb,
         years_of_experience = $6,
         primary_role = $7,
         top_skills = $8::text[],
         resume_score = $9,
         raw_text = $10,
         updated_at = now()
       WHERE id = $11
         AND user_id = $12
       RETURNING *`,
      [
        updates.summary,
        JSON.stringify(updates.work_experience ?? null),
        JSON.stringify(updates.education ?? null),
        JSON.stringify(updates.skills ?? null),
        JSON.stringify(updates.projects ?? null),
        updates.years_of_experience,
        updates.primary_role,
        updates.top_skills ?? [],
        updates.resume_score,
        updates.raw_text,
        resume.id,
        user.id,
      ]
    ),
    pool.query(
      `UPDATE resume_edits
       SET was_accepted = true
       WHERE id = $1
         AND user_id = $2`,
      [edit.id, user.id]
    ),
  ])
  const updatedResume = updatedRows[0]

  if (!updatedResume) {
    return NextResponse.json(
      { error: "Failed to update resume" },
      { status: 500 }
    )
  }

  if (markResult.rowCount === 0) {
    console.error("Failed to mark resume edit accepted", { editId: edit.id, userId: user.id })
  }

  try {
    const signedUrl = await getResumeUrl(updatedResume.storage_path)
    return NextResponse.json({
      ...updatedResume,
      file_url: signedUrl,
      download_url: signedUrl,
    })
  } catch {
    return NextResponse.json(updatedResume)
  }
}
