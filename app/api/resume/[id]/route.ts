import { NextResponse } from "next/server"
import { deriveResumeFields } from "@/lib/resume/scoring"
import { buildResumeRawText } from "@/lib/resume/state"
import { getPostgresPool } from "@/lib/postgres/server"
import { deleteResume, getResumeUrl } from "@/lib/supabase/storage"
import { createClient } from "@/lib/supabase/server"
import type { Education, Project, Resume, Skills, WorkExperience } from "@/types"

export const runtime = "nodejs"

async function getAuthedResume(id: string, userId: string) {
  const pool = getPostgresPool()
  const result = await pool.query<Resume>(
    `SELECT *
     FROM resumes
     WHERE id = $1
       AND user_id = $2
     LIMIT 1`,
    [id, userId]
  )

  return result.rows[0] ?? null
}

export async function GET(
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

  const resume = await getAuthedResume(params.id, user.id)
  if (!resume) {
    return NextResponse.json({ error: "Resume not found" }, { status: 404 })
  }

  try {
    const signedUrl = await getResumeUrl(resume.storage_path)
    return NextResponse.json({
      ...resume,
      file_url: signedUrl,
      download_url: signedUrl,
    })
  } catch {
    return NextResponse.json(resume)
  }
}

export async function DELETE(
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

  const pool = getPostgresPool()

  const resume = await getAuthedResume(params.id, user.id)
  if (!resume) {
    return NextResponse.json({ error: "Resume not found" }, { status: 404 })
  }

  try {
    await deleteResume(resume.storage_path)
  } catch (error) {
    console.error("Failed to delete resume from storage", error)
  }

  await pool.query(
    `DELETE FROM resumes
     WHERE id = $1
       AND user_id = $2`,
    [resume.id, user.id]
  )

  if (resume.is_primary) {
    const remaining = await pool.query<{ id: string }>(
      `SELECT id
       FROM resumes
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [user.id]
    )

    const nextPrimaryId = remaining.rows[0]?.id
    if (nextPrimaryId) {
      await pool.query(
        `UPDATE resumes
         SET is_primary = true
         WHERE id = $1
           AND user_id = $2`,
        [nextPrimaryId, user.id]
      )
    }
  }

  return NextResponse.json({ success: true })
}

export async function PATCH(
  request: Request,
  { params: routeParams }: { params: { id: string } }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const pool = getPostgresPool()

  const resume = await getAuthedResume(routeParams.id, user.id)
  if (!resume) {
    return NextResponse.json({ error: "Resume not found" }, { status: 404 })
  }

  const body = await request.json()
  const updates: Partial<Resume> = {}

  if (typeof body.name === "string") {
    updates.name = body.name.trim() || null
  }

  if (body.is_primary === true) {
    await pool.query(
      `UPDATE resumes
       SET is_primary = false
       WHERE user_id = $1`,
      [user.id]
    )

    updates.is_primary = true
  }

  if (typeof body.summary === "string" || body.summary === null) {
    updates.summary = typeof body.summary === "string" ? body.summary.trim() : null
  }

  if (Array.isArray(body.work_experience)) {
    updates.work_experience = body.work_experience as WorkExperience[]
  }

  if (Array.isArray(body.education)) {
    updates.education = body.education as Education[]
  }

  if (body.skills && typeof body.skills === "object") {
    updates.skills = body.skills as Skills
  }

  if (Array.isArray(body.projects)) {
    updates.projects = body.projects as Project[]
  }

  const contentChanged = ["summary", "work_experience", "education", "skills", "projects"].some(
    (key) => key in updates
  )

  if (contentChanged) {
    const nextResume: Resume = {
      ...resume,
      ...updates,
    }

    updates.raw_text = buildResumeRawText(nextResume)
    Object.assign(updates, deriveResumeFields(nextResume))
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid updates provided" }, { status: 400 })
  }

  const entries = Object.entries(updates) as Array<[keyof Resume, unknown]>
  const sqlParams: unknown[] = []
  const setSql = entries.map(([key, value]) => {
    sqlParams.push(value)
    const idx = sqlParams.length
    const jsonbFields = new Set(["work_experience", "education", "skills", "projects", "experience"])
    const cast = jsonbFields.has(String(key)) ? "::jsonb" : ""
    if (cast) {
      sqlParams[idx - 1] = JSON.stringify(value)
    }
    return `${String(key)} = $${idx}${cast}`
  })
  sqlParams.push(resume.id, user.id)

  const result = await pool.query<Resume>(
    `UPDATE resumes
     SET ${setSql.join(", ")}, updated_at = now()
     WHERE id = $${sqlParams.length - 1}
       AND user_id = $${sqlParams.length}
     RETURNING *`,
    sqlParams
  )
  const data = result.rows[0]

  if (!data) {
    return NextResponse.json({ error: "Failed to update resume" }, { status: 500 })
  }

  try {
    const signedUrl = await getResumeUrl(data.storage_path)
    return NextResponse.json({
      ...data,
      file_url: signedUrl,
      download_url: signedUrl,
    })
  } catch {
    return NextResponse.json(data)
  }
}
