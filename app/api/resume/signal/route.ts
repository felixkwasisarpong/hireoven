import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"
import {
  detectResumeSignal,
  scoreResumeAgainstProfiles,
  buildPositioningBrief,
  fieldSignatureToProfile,
  FIELDS,
  type FieldProfile,
} from "@/lib/resume/signal"
import { getFieldProfiles } from "@/lib/resume/field-profiles"
import type { Resume } from "@/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// What field is the user's resume actually signalling? Runs the signal detector
// over their primary (parsed) resume. Pass ?target=<field_key> to also get an
// honest positioning brief for that field.
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

  // Prefer corpus-grounded scoring (against what real jobs in each field ask
  // for); fall back to the keyword signatures until profiles are built.
  const profiles = await getFieldProfiles(pool).catch(() => [])
  const grounded = profiles.length > 0
  const signal = grounded ? scoreResumeAgainstProfiles(resume, profiles) : detectResumeSignal(resume)

  // Optional positioning brief for a chosen target field. Use the corpus profile
  // when built, else synthesize one from the field signature so it works today.
  const target = new URL(request.url).searchParams.get("target")
  let brief = null
  if (target) {
    const profile: FieldProfile | undefined = grounded
      ? profiles.find((p) => p.key === target)
      : (() => {
          const sig = FIELDS.find((f) => f.key === target)
          return sig ? fieldSignatureToProfile(sig) : undefined
        })()
    if (profile) brief = buildPositioningBrief(resume, profile)
  }

  return NextResponse.json(
    { hasResume: true, primaryRole: resume.primary_role ?? null, grounded, signal, brief },
    { headers: { "Cache-Control": "no-store" } },
  )
}
