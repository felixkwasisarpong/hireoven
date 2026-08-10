import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"
import { detectResumeSignal } from "@/lib/resume/signal"
import type { Resume } from "@/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// What field is the user's resume actually signalling? Runs the signal detector
// over their primary (parsed) resume.
export async function GET() {
  if (!hasPostgresEnv()) return NextResponse.json({ hasResume: false })

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const pool = getPostgresPool()
  const { rows } = await pool.query<
    Pick<Resume, "primary_role" | "top_skills" | "skills" | "work_experience" | "industries" | "summary" | "raw_text">
  >(
    `SELECT primary_role, top_skills, skills, work_experience, industries, summary, raw_text
       FROM resumes
      WHERE user_id = $1 AND archived_at IS NULL AND parse_status = 'complete'
      ORDER BY is_primary DESC, updated_at DESC
      LIMIT 1`,
    [user.id],
  )

  const resume = rows[0]
  if (!resume) return NextResponse.json({ hasResume: false })

  const signal = detectResumeSignal(resume)
  return NextResponse.json(
    { hasResume: true, primaryRole: resume.primary_role ?? null, signal },
    { headers: { "Cache-Control": "no-store" } },
  )
}
