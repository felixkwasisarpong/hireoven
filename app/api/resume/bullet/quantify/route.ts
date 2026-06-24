/**
 * POST /api/resume/bullet/quantify
 *
 * Two-step metric elicitation for a single resume bullet:
 *   mode "questions" — return 1–4 targeted questions about the metrics this
 *                      bullet could carry (no rewrite yet).
 *   mode "rewrite"   — given the candidate's answers, rewrite the bullet using
 *                      ONLY the numbers they provided, and persist a
 *                      resume_edits row (so Accept/Reject analytics work like
 *                      the rest of the bullet editor).
 *
 * Auth + ownership mirror /api/resume/edit: a signed-in user editing their own
 * resume. The flow never invents metrics, so it carries no extra fabrication
 * risk beyond what the candidate types.
 */

import { NextResponse } from "next/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { createClient } from "@/lib/supabase/server"
import {
  generateMetricQuestions,
  rewriteBulletWithMetrics,
  type MetricAnswer,
} from "@/lib/resume/metric-elicitation"
import type { Resume } from "@/types"

export const runtime = "nodejs"
export const maxDuration = 60

type Body = {
  mode?: "questions" | "rewrite"
  resumeId?: string
  bullet?: string
  jobId?: string
  experienceIndex?: number
  bulletIndex?: number
  answers?: { label?: unknown; value?: unknown }[]
}

async function getAuthedResume(resumeId: string, userId: string): Promise<Resume | null> {
  const pool = getPostgresPool()
  const result = await pool.query<Resume>(
    `SELECT * FROM resumes WHERE id = $1 AND user_id = $2 LIMIT 1`,
    [resumeId, userId]
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

  const body = (await request.json().catch(() => ({}))) as Body
  const mode = body.mode === "rewrite" ? "rewrite" : "questions"
  const bullet = typeof body.bullet === "string" ? body.bullet.trim() : ""

  if (!body.resumeId || !bullet) {
    return NextResponse.json({ error: "resumeId and bullet are required" }, { status: 400 })
  }

  const resume = await getAuthedResume(body.resumeId, user.id)
  if (!resume) {
    return NextResponse.json({ error: "Resume not found" }, { status: 404 })
  }

  const experience =
    typeof body.experienceIndex === "number"
      ? resume.work_experience?.[body.experienceIndex]
      : null
  const jobTitle = experience?.title ?? resume.primary_role ?? "Previous role"
  const company = experience?.company ?? "the company"

  // Pull job description context if a target job was provided (optional).
  let jobDescription: string | null = null
  if (body.jobId) {
    const pool = getPostgresPool()
    const jobRes = await pool.query<{ description: string | null }>(
      `SELECT description FROM jobs WHERE id = $1 LIMIT 1`,
      [body.jobId]
    )
    jobDescription = jobRes.rows[0]?.description ?? null
  }

  if (mode === "questions") {
    const questions = await generateMetricQuestions({ bullet, jobTitle, company, jobDescription })
    return NextResponse.json({ questions })
  }

  // mode === "rewrite"
  const answers: MetricAnswer[] = Array.isArray(body.answers)
    ? body.answers
        .map((a) => ({
          label: typeof a?.label === "string" ? a.label : "",
          value: typeof a?.value === "string" ? a.value : "",
        }))
        .filter((a) => a.label)
    : []

  const { suggestion, usedMetrics } = await rewriteBulletWithMetrics({
    bullet,
    jobTitle,
    company,
    jobDescription,
    answers,
  })

  // Persist for Accept/Reject analytics, mirroring /api/resume/edit.
  let editId: string | null = null
  try {
    const pool = getPostgresPool()
    const insertResult = await pool.query<{ id: string }>(
      `INSERT INTO resume_edits (
         user_id, resume_id, job_id, section, original_content, suggested_content,
         edit_type, keywords_added, was_accepted, feedback, context
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::text[],$9,$10,$11::jsonb)
       RETURNING id`,
      [
        user.id,
        resume.id,
        body.jobId ?? null,
        "work_experience",
        bullet,
        suggestion,
        "quantify",
        [],
        null,
        null,
        JSON.stringify({
          experienceIndex: body.experienceIndex ?? null,
          bulletIndex: body.bulletIndex ?? null,
          field: "achievement",
        }),
      ]
    )
    editId = insertResult.rows[0]?.id ?? null
  } catch (error) {
    console.error("quantify: failed to persist resume_edit", error)
  }

  return NextResponse.json({ suggestion, usedMetrics, editId })
}
