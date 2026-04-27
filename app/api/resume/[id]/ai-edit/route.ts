import { NextResponse } from "next/server"
import { getPostgresPool } from "@/lib/postgres/server"
import {
  applyAiEditPatch,
  createAiEditPatch,
  createResumeSnapshot,
  isResumeAiToolId,
  isUuid,
} from "@/lib/resume/hub"
import { createClient } from "@/lib/supabase/server"
import type { Resume, ResumeAiEditRecord } from "@/types"

export const runtime = "nodejs"

type AiEditBody = {
  toolId?: string
  instructions?: string
  jobDescription?: string
  apply?: boolean
}

const TOOL_LABELS: Record<string, string> = {
  improve_bullets: "Improve Bullet Points",
  rewrite_summary: "Rewrite Summary",
  ats_optimize: "ATS Optimization",
  add_metrics: "Add Measurable Impact",
  shorten: "Shorten Resume",
  fix_grammar: "Fix Grammar",
  improve_keywords: "Improve Keywords",
  convert_achievements: "Convert to Achievements",
}

async function ensureResumeAiEditsTable(pool: ReturnType<typeof getPostgresPool>) {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS resume_ai_edits (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
      resume_id UUID REFERENCES resumes(id) ON DELETE CASCADE,
      tool_id TEXT NOT NULL,
      label TEXT,
      input_snapshot JSONB,
      output_patch JSONB,
      status TEXT DEFAULT 'complete',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`
  )
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_resume_ai_edits_user_resume_created
     ON resume_ai_edits(user_id, resume_id, created_at DESC)`
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

  const body = (await request.json().catch(() => ({}))) as AiEditBody
  if (!isResumeAiToolId(body.toolId)) {
    return NextResponse.json({ error: "Unsupported toolId" }, { status: 400 })
  }

  const pool = getPostgresPool()
  await ensureResumeAiEditsTable(pool)
  const result = await pool.query<Resume>(
    `SELECT * FROM resumes WHERE id = $1 AND user_id = $2 LIMIT 1`,
    [id, user.id]
  )
  const resume = result.rows[0]
  if (!resume) return NextResponse.json({ error: "Resume not found" }, { status: 404 })

  const patch = createAiEditPatch(resume, body.toolId, body.instructions, body.jobDescription)
  const updatedPreview = applyAiEditPatch(resume, patch)
  const snapshot = createResumeSnapshot(resume)

  const insert = await pool.query<ResumeAiEditRecord>(
    `INSERT INTO resume_ai_edits (
      user_id,
      resume_id,
      tool_id,
      label,
      input_snapshot,
      output_patch,
      status
    ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, 'complete')
    RETURNING *`,
    [
      user.id,
      resume.id,
      body.toolId,
      TOOL_LABELS[body.toolId],
      JSON.stringify(snapshot),
      JSON.stringify(patch),
    ]
  )
  const edit = insert.rows[0]
  let appliedResume: Resume | null = null

  if (body.apply === true) {
    appliedResume = await updateResumeFromPreview(pool, updatedPreview, user.id)
  }

  return NextResponse.json({
    editId: edit?.id,
    edit,
    output_patch: patch,
    updated_preview: appliedResume ?? updatedPreview,
    applied: body.apply === true,
  })
}

async function updateResumeFromPreview(
  pool: ReturnType<typeof getPostgresPool>,
  resume: Resume,
  userId: string
) {
  const result = await pool.query<Resume>(
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
      resume.summary,
      JSON.stringify(resume.work_experience ?? null),
      JSON.stringify(resume.skills ?? null),
      resume.top_skills ?? [],
      resume.years_of_experience,
      resume.primary_role,
      resume.resume_score,
      resume.ats_score ?? null,
      resume.raw_text,
      resume.id,
      userId,
    ]
  )
  return result.rows[0] ?? resume
}
