import { NextResponse } from "next/server"
import { improveSummary, rewriteBulletPoint } from "@/lib/resume/editor"
import { getPostgresPool } from "@/lib/postgres/server"
import { createClient } from "@/lib/supabase/server"
import type { Job, Resume, ResumeEditContext, ResumeEditInsert, ResumeEditType, ResumeSection } from "@/types"

export const runtime = "nodejs"
export const maxDuration = 60

type EditRequestBody = {
  resumeId?: string
  section?: ResumeSection
  originalContent?: string
  editType?: ResumeEditType
  jobId?: string
  missingKeywords?: string[]
  context?: ResumeEditContext | null
}

async function getAuthedResume(resumeId: string, userId: string) {
  const pool = getPostgresPool()
  const result = await pool.query<Resume>(
    `SELECT *
     FROM resumes
     WHERE id = $1
       AND user_id = $2
     LIMIT 1`,
    [resumeId, userId]
  )

  return result.rows[0] ?? null
}

async function getJob(jobId: string) {
  const pool = getPostgresPool()
  const result = await pool.query<Job>(
    `SELECT *
     FROM jobs
     WHERE id = $1
     LIMIT 1`,
    [jobId]
  )

  return result.rows[0] ?? null
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

  const body = (await request.json().catch(() => ({}))) as EditRequestBody

  if (!body.resumeId || !body.section || !body.editType || typeof body.originalContent !== "string") {
    return NextResponse.json(
      { error: "resumeId, section, editType, and originalContent are required" },
      { status: 400 }
    )
  }

  const originalContent = body.originalContent

  const resume = await getAuthedResume(body.resumeId, user.id)
  if (!resume) {
    return NextResponse.json({ error: "Resume not found" }, { status: 404 })
  }

  const job = body.jobId ? await getJob(body.jobId) : null

  let suggestion = originalContent
  let keywordsAdded: string[] = []

  try {
    if (body.section === "summary") {
      suggestion = await improveSummary(originalContent || resume.summary, resume, job ?? undefined)
      keywordsAdded = (body.missingKeywords ?? []).filter((keyword) =>
        suggestion.toLowerCase().includes(keyword.toLowerCase()) &&
        !originalContent.toLowerCase().includes(keyword.toLowerCase())
      )
    } else if (body.section === "work_experience") {
      const experience = typeof body.context?.experienceIndex === "number"
        ? resume.work_experience?.[body.context.experienceIndex]
        : null

      const result = await rewriteBulletPoint(originalContent, {
        jobTitle: experience?.title ?? resume.primary_role ?? "Previous role",
        company: experience?.company ?? resume.full_name ?? "Candidate",
        missingKeywords: body.missingKeywords ?? [],
        targetJob: job
          ? {
              title: job.title,
              description: job.description ?? "",
            }
          : undefined,
        editType: body.editType,
      })

      suggestion = result.suggestion
      keywordsAdded = result.keywordsAdded
    } else {
      return NextResponse.json(
        { error: "This section is not supported by the AI editor yet" },
        { status: 400 }
      )
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to generate suggestion"
    return NextResponse.json({ error: message }, { status: 500 })
  }

  const payload: ResumeEditInsert = {
    user_id: user.id,
    resume_id: resume.id,
    job_id: body.jobId ?? null,
    section: body.section,
    original_content: originalContent,
    suggested_content: suggestion,
    edit_type: body.editType,
    keywords_added: keywordsAdded,
    was_accepted: null,
    feedback: null,
    context: body.context ?? null,
  }

  const insertResult = await pool.query<Record<string, unknown>>(
    `INSERT INTO resume_edits (
      user_id,
      resume_id,
      job_id,
      section,
      original_content,
      suggested_content,
      edit_type,
      keywords_added,
      was_accepted,
      feedback,
      context
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8::text[], $9, $10, $11::jsonb
    )
    RETURNING *`,
    [
      payload.user_id,
      payload.resume_id,
      payload.job_id,
      payload.section,
      payload.original_content,
      payload.suggested_content,
      payload.edit_type,
      payload.keywords_added ?? [],
      payload.was_accepted,
      payload.feedback,
      JSON.stringify(payload.context ?? null),
    ]
  )
  const data = insertResult.rows[0]
  if (!data) {
    return NextResponse.json({ error: "Failed to save suggestion" }, { status: 500 })
  }

  return NextResponse.json({
    suggestion,
    keywordsAdded,
    editId: data.id,
    edit: data,
  })
}
