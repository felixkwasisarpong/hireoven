import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"
import { detectResumeSignal, scoreResumeAgainstProfiles, type ResumeSignal } from "@/lib/resume/signal"
import { getFieldProfiles } from "@/lib/resume/field-profiles"
import { computeBridgePath } from "@/lib/resume/bridge"
import type { Resume } from "@/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Career pivot: how does the user get from the field their resume reads as to a
// target field? GET ?to=<field_key> (optionally ?from=<field_key>) returns the
// ranked signal (so the UI knows the current lane + can offer targets) and, when
// `to` is set, the bridge path.
export async function GET(request: Request) {
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

  const profiles = await getFieldProfiles(pool).catch(() => [])
  const grounded = profiles.length > 0
  const signal: ResumeSignal = grounded ? scoreResumeAgainstProfiles(resume, profiles) : detectResumeSignal(resume)

  const url = new URL(request.url)
  const to = url.searchParams.get("to")
  // Default the origin field to the one the resume reads strongest as.
  const from = url.searchParams.get("from") ?? signal.primary?.key ?? null

  const bridge = to && from ? await computeBridgePath(pool, resume, from, to).catch(() => null) : null

  return NextResponse.json(
    { hasResume: true, grounded, signal, from, bridge },
    { headers: { "Cache-Control": "no-store" } },
  )
}
