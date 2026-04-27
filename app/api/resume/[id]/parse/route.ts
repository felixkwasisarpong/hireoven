import { NextResponse } from "next/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { parseResumeTextFallback, isUuid } from "@/lib/resume/hub"
import { createClient } from "@/lib/supabase/server"
import type { Resume } from "@/types"

export const runtime = "nodejs"

type ParseBody = {
  text?: string
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

  const pool = getPostgresPool()
  const current = await pool.query<Resume>(
    `SELECT * FROM resumes WHERE id = $1 AND user_id = $2 LIMIT 1`,
    [id, user.id]
  )
  const resume = current.rows[0]
  if (!resume) return NextResponse.json({ error: "Resume not found" }, { status: 404 })

  await pool.query(
    `UPDATE resumes
     SET parse_status = 'processing', parse_error = NULL, updated_at = now()
     WHERE id = $1 AND user_id = $2`,
    [id, user.id]
  )

  try {
    const body = (await request.json().catch(() => ({}))) as ParseBody
    const parsed = parseResumeTextFallback(resume, body.text)

    const result = await pool.query<Resume>(
      `UPDATE resumes
       SET
         parse_status = 'complete',
         parse_error = NULL,
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
         years_of_experience = $14,
         primary_role = $15,
         top_skills = $16::text[],
         resume_score = $17,
         ats_score = $18,
         raw_text = $19,
         updated_at = now()
       WHERE id = $20 AND user_id = $21
       RETURNING *`,
      [
        parsed.full_name,
        parsed.email,
        parsed.phone,
        parsed.location,
        parsed.linkedin_url,
        parsed.portfolio_url,
        parsed.github_url ?? null,
        parsed.summary,
        JSON.stringify(parsed.work_experience ?? null),
        JSON.stringify(parsed.education ?? null),
        JSON.stringify(parsed.skills ?? null),
        JSON.stringify(parsed.projects ?? null),
        JSON.stringify(parsed.certifications ?? null),
        parsed.years_of_experience,
        parsed.primary_role,
        parsed.top_skills ?? [],
        parsed.resume_score,
        parsed.ats_score ?? null,
        parsed.raw_text,
        id,
        user.id,
      ]
    )

    return NextResponse.json(result.rows[0])
  } catch (error) {
    const message = error instanceof Error ? error.message : "Resume parsing failed"
    await pool.query(
      `UPDATE resumes
       SET parse_status = 'failed', parse_error = $1, updated_at = now()
       WHERE id = $2 AND user_id = $3`,
      [message, id, user.id]
    )
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
