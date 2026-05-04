/**
 * POST /api/resume/tailor-save
 *
 * Save a tailored copy of a resume — creates a NEW row in the `resumes` table
 * tagged with parent_resume_id + tailored_for_job_id + tailored_for_company +
 * tailored_for_role. Idempotent on (user_id, tailored_for_job_id): saving
 * again for the same job updates the existing tailored copy rather than
 * proliferating duplicates.
 *
 * This is distinct from PATCH /api/resume/[id]:
 *   - PATCH /api/resume/[id]                — edit-in-place on the canonical resume
 *   - POST  /api/resume/tailor-save         — copy-on-write per saved job
 *
 * Auth: cookie session (same as the rest of the dashboard API).
 */

import { NextResponse } from "next/server"
import { randomUUID } from "crypto"
import { getPostgresPool } from "@/lib/postgres/server"
import { getSessionUser } from "@/lib/auth/session-user"
import type { Resume } from "@/types"

export const runtime = "nodejs"

interface TailorSaveBody {
  parentResumeId: string
  jobId: string
  payload: {
    name?: string | null
    full_name?: string | null
    email?: string | null
    phone?: string | null
    location?: string | null
    portfolio_url?: string | null
    linkedin_url?: string | null
    github_url?: string | null
    primary_role?: string | null
    summary?: string | null
    work_experience?: unknown
    education?: unknown
    skills?: unknown
    projects?: unknown
    certifications?: unknown
  }
}

export async function POST(request: Request) {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let body: TailorSaveBody
  try {
    body = (await request.json()) as TailorSaveBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  if (!body.parentResumeId || !body.jobId || !body.payload) {
    return NextResponse.json(
      { error: "parentResumeId, jobId, and payload are required" },
      { status: 400 },
    )
  }

  const pool = getPostgresPool()

  // Verify the parent resume belongs to this user.
  const parentResult = await pool.query<{ id: string }>(
    `SELECT id FROM resumes WHERE id = $1 AND user_id = $2 LIMIT 1`,
    [body.parentResumeId, session.sub],
  )
  if (parentResult.rows.length === 0) {
    return NextResponse.json({ error: "Parent resume not found" }, { status: 404 })
  }

  // Resolve job context — title + company. Used both for the saved row's
  // tailored_for_role / tailored_for_company columns and for the resume name.
  const jobResult = await pool.query<{
    title: string | null
    company_name: string | null
  }>(
    `SELECT j.title,
            COALESCE(c.name, ja.company_name) AS company_name
     FROM jobs j
     LEFT JOIN companies c ON c.id = j.company_id
     LEFT JOIN job_applications ja
            ON ja.job_id = j.id AND ja.user_id = $2 AND ja.is_archived = false
     WHERE j.id = $1
     LIMIT 1`,
    [body.jobId, session.sub],
  )
  const jobRow = jobResult.rows[0]
  if (!jobRow) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 })
  }

  const tailoredCompany = jobRow.company_name?.trim() || null
  const tailoredRole = jobRow.title?.trim() || null
  const resumeName =
    body.payload.name?.trim() ||
    [tailoredRole, tailoredCompany].filter(Boolean).join(" — ") ||
    "Tailored resume"

  const p = body.payload

  // Idempotency: upsert by (user_id, tailored_for_job_id). If the user runs
  // through Tailor → Save twice for the same job, the second save updates
  // the existing tailored copy in place.
  const existingResult = await pool.query<{ id: string }>(
    `SELECT id FROM resumes
     WHERE user_id = $1 AND tailored_for_job_id = $2
     ORDER BY updated_at DESC
     LIMIT 1`,
    [session.sub, body.jobId],
  )
  const existingId = existingResult.rows[0]?.id

  let savedRow: Resume

  if (existingId) {
    const upd = await pool.query<Resume>(
      `UPDATE resumes
       SET name = $3,
           full_name = $4,
           email = $5,
           phone = $6,
           location = $7,
           portfolio_url = $8,
           linkedin_url = $9,
           github_url = $10,
           primary_role = $11,
           summary = $12,
           work_experience = $13::jsonb,
           education = $14::jsonb,
           skills = $15::jsonb,
           projects = $16::jsonb,
           certifications = $17::jsonb,
           tailored_for_company = $18,
           tailored_for_role = $19,
           updated_at = NOW()
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [
        existingId,
        session.sub,
        resumeName,
        p.full_name ?? null,
        p.email ?? null,
        p.phone ?? null,
        p.location ?? null,
        p.portfolio_url ?? null,
        p.linkedin_url ?? null,
        p.github_url ?? null,
        p.primary_role ?? null,
        p.summary ?? null,
        JSON.stringify(p.work_experience ?? []),
        JSON.stringify(p.education ?? []),
        JSON.stringify(p.skills ?? {}),
        JSON.stringify(p.projects ?? []),
        JSON.stringify(p.certifications ?? []),
        tailoredCompany,
        tailoredRole,
      ],
    )
    savedRow = upd.rows[0]
  } else {
    const newId = randomUUID()
    const ins = await pool.query<Resume>(
      `INSERT INTO resumes (
         id, user_id, name, file_name, parse_status,
         full_name, email, phone, location,
         portfolio_url, linkedin_url, github_url,
         primary_role, summary,
         work_experience, education, skills, projects, certifications,
         is_primary,
         parent_resume_id, tailored_for_job_id, tailored_for_company, tailored_for_role,
         created_at, updated_at
       ) VALUES (
         $1, $2, $3, $3, 'parsed',
         $4, $5, $6, $7,
         $8, $9, $10,
         $11, $12,
         $13::jsonb, $14::jsonb, $15::jsonb, $16::jsonb, $17::jsonb,
         false,
         $18, $19, $20, $21,
         NOW(), NOW()
       )
       RETURNING *`,
      [
        newId,
        session.sub,
        resumeName,
        p.full_name ?? null,
        p.email ?? null,
        p.phone ?? null,
        p.location ?? null,
        p.portfolio_url ?? null,
        p.linkedin_url ?? null,
        p.github_url ?? null,
        p.primary_role ?? null,
        p.summary ?? null,
        JSON.stringify(p.work_experience ?? []),
        JSON.stringify(p.education ?? []),
        JSON.stringify(p.skills ?? {}),
        JSON.stringify(p.projects ?? []),
        JSON.stringify(p.certifications ?? []),
        body.parentResumeId,
        body.jobId,
        tailoredCompany,
        tailoredRole,
      ],
    )
    savedRow = ins.rows[0]
  }

  return NextResponse.json({
    resume: savedRow,
    created: !existingId,
    updated: Boolean(existingId),
  })
}
