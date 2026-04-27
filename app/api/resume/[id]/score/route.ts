import { NextResponse } from "next/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { buildResumeScoreBreakdown, isUuid } from "@/lib/resume/hub"
import { createClient } from "@/lib/supabase/server"
import type { Resume } from "@/types"

export const runtime = "nodejs"

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const { id } = params
  if (!isUuid(id)) return NextResponse.json({ error: "Invalid resume id" }, { status: 400 })

  const supabase = await createClient()
  const user = (await supabase.auth.getUser()).data.user
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const pool = getPostgresPool()
  const result = await pool.query<Resume>(
    `SELECT * FROM resumes WHERE id = $1 AND user_id = $2 LIMIT 1`,
    [id, user.id]
  )
  const resume = result.rows[0]
  if (!resume) return NextResponse.json({ error: "Resume not found" }, { status: 404 })

  const score = buildResumeScoreBreakdown(resume)

  if (resume.resume_score !== score.overall || resume.ats_score !== score.atsReadability) {
    await pool.query(
      `UPDATE resumes
       SET resume_score = $1, ats_score = $2, updated_at = now()
       WHERE id = $3 AND user_id = $4`,
      [score.overall, score.atsReadability, id, user.id]
    )
  }

  return NextResponse.json(score)
}
