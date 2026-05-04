import { NextResponse } from "next/server"
import { deriveResumeFields } from "@/lib/resume/scoring"
import { buildResumeScoreBreakdown } from "@/lib/resume/hub"
import { buildResumeRawText } from "@/lib/resume/state"
import { normalizeSkillsBuckets } from "@/lib/skills/taxonomy"
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
       ADD COLUMN IF NOT EXISTS top_skills TEXT[],
       ADD COLUMN IF NOT EXISTS years_of_experience NUMERIC,
       ADD COLUMN IF NOT EXISTS resume_score INTEGER,
       ADD COLUMN IF NOT EXISTS primary_role TEXT,
       ADD COLUMN IF NOT EXISTS seniority_level TEXT,
       ADD COLUMN IF NOT EXISTS industries JSONB`
  )
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

  const sharedFile = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM resumes
     WHERE storage_path = $1
       AND id <> $2`,
    [resume.storage_path, resume.id]
  )

  if (Number(sharedFile.rows[0]?.count ?? 0) === 0) {
    try {
      await deleteResume(resume.storage_path)
    } catch (error) {
      console.error("Failed to delete resume from storage", error)
    }
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
  await ensureResumeLifecycleColumns()

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
    updates.archived_at = null
  }

  if (typeof body.archived === "boolean") {
    updates.archived_at = body.archived ? new Date().toISOString() : null
    if (body.archived) {
      updates.is_primary = false
    }
  }

  if (typeof body.summary === "string" || body.summary === null) {
    updates.summary = typeof body.summary === "string" ? body.summary.trim() : null
  }

  if (typeof body.full_name === "string" || body.full_name === null) {
    updates.full_name = typeof body.full_name === "string" ? body.full_name.trim() : null
  }

  if (typeof body.email === "string" || body.email === null) {
    updates.email = typeof body.email === "string" ? body.email.trim() : null
  }

  if (typeof body.phone === "string" || body.phone === null) {
    updates.phone = typeof body.phone === "string" ? body.phone.trim() : null
  }

  if (typeof body.location === "string" || body.location === null) {
    updates.location = typeof body.location === "string" ? body.location.trim() : null
  }

  if (typeof body.linkedin_url === "string" || body.linkedin_url === null) {
    updates.linkedin_url = typeof body.linkedin_url === "string" ? body.linkedin_url.trim() : null
  }

  if (typeof body.portfolio_url === "string" || body.portfolio_url === null) {
    updates.portfolio_url = typeof body.portfolio_url === "string" ? body.portfolio_url.trim() : null
  }

  if (typeof body.github_url === "string" || body.github_url === null) {
    updates.github_url = typeof body.github_url === "string" ? body.github_url.trim() : null
  }

  if (typeof body.primary_role === "string" || body.primary_role === null) {
    updates.primary_role = typeof body.primary_role === "string" ? body.primary_role.trim() : null
  }

  if (Array.isArray(body.work_experience)) {
    updates.work_experience = body.work_experience as WorkExperience[]
  }

  if (Array.isArray(body.education)) {
    updates.education = body.education as Education[]
  }

  if (body.skills && typeof body.skills === "object") {
    updates.skills = normalizeSkillsBuckets(body.skills as Skills)
  }

  if (Array.isArray(body.projects)) {
    updates.projects = body.projects as Project[]
  }

  if (Array.isArray(body.certifications)) {
    updates.certifications = body.certifications
  }

  const contentChanged = ["summary", "work_experience", "education", "skills", "projects", "certifications", "primary_role"].some(
    (key) => key in updates
  )

  if (contentChanged) {
    const nextResume: Resume = {
      ...resume,
      ...updates,
    }

    updates.raw_text = buildResumeRawText(nextResume)
    Object.assign(updates, deriveResumeFields(nextResume))
    updates.ats_score = buildResumeScoreBreakdown(nextResume).atsReadability
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid updates provided" }, { status: 400 })
  }

  const entries = Object.entries(updates) as Array<[keyof Resume, unknown]>
  const sqlParams: unknown[] = []
  const setSql = entries.map(([key, value]) => {
    sqlParams.push(value)
    const idx = sqlParams.length
    const jsonbFields = new Set(["work_experience", "education", "skills", "projects", "experience", "certifications", "industries"])
    const textArrayFields = new Set(["top_skills"])
    const fieldKey = String(key)
    if (jsonbFields.has(fieldKey)) {
      sqlParams[idx - 1] = JSON.stringify(value)
      return `${fieldKey} = $${idx}::jsonb`
    }
    if (textArrayFields.has(fieldKey)) {
      // top_skills is text[] — send as native array, no JSON serialization
      return `${fieldKey} = $${idx}::text[]`
    }
    return `${fieldKey} = $${idx}`
  })
  sqlParams.push(resume.id, user.id)

  let patchRows: Resume[]
  try {
    const patchResult = await pool.query<Resume>(
      `UPDATE resumes
       SET ${setSql.join(", ")}, updated_at = now()
       WHERE id = $${sqlParams.length - 1}
         AND user_id = $${sqlParams.length}
       RETURNING *`,
      sqlParams
    )
    patchRows = patchResult.rows
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("[resume PATCH] SQL failed:", msg)
    return NextResponse.json({ error: `Save failed: ${msg}` }, { status: 500 })
  }
  const data = patchRows[0]

  if (!data) {
    return NextResponse.json({ error: "Failed to update resume" }, { status: 500 })
  }

  if (body.archived === true && resume.is_primary) {
    const nextPrimary = await pool.query<{ id: string }>(
      `SELECT id
       FROM resumes
       WHERE user_id = $1
         AND id <> $2
         AND archived_at IS NULL
       ORDER BY updated_at DESC, created_at DESC
       LIMIT 1`,
      [user.id, resume.id]
    )
    const nextPrimaryId = nextPrimary.rows[0]?.id
    if (nextPrimaryId) {
      await pool.query(
        `UPDATE resumes
         SET is_primary = true, updated_at = now()
         WHERE id = $1
           AND user_id = $2`,
        [nextPrimaryId, user.id]
      )
    }
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
