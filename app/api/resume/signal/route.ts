import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"
import {
  detectResumeSignal,
  scoreResumeAgainstProfiles,
  buildPositioningBrief,
  fieldSignatureToProfile,
  isFieldKey,
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
    Pick<
      Resume,
      "primary_role" | "top_skills" | "skills" | "work_experience" | "industries" | "summary" | "raw_text" | "target_field"
    >
  >(
    `SELECT primary_role, top_skills, skills, work_experience, industries, summary, raw_text, target_field
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
    {
      hasResume: true,
      primaryRole: resume.primary_role ?? null,
      grounded,
      signal,
      brief,
      targetField: resume.target_field ?? null,
    },
    { headers: { "Cache-Control": "no-store" } },
  )
}

// Save (or clear) the user's chosen matching lane. Writing target_field also
// touches updated_at, which bumps the score-cache resume_version so cached
// matches recompute with the new positioning. Body: { target: string | null }.
export async function POST(request: Request) {
  if (!hasPostgresEnv()) return NextResponse.json({ error: "Unavailable" }, { status: 503 })

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = (await request.json().catch(() => ({}))) as { target?: unknown }
  const raw = body.target
  const target = raw === null || raw === "" ? null : typeof raw === "string" ? raw : undefined
  if (target === undefined || (target !== null && !isFieldKey(target))) {
    return NextResponse.json({ error: "Invalid target field" }, { status: 400 })
  }

  const pool = getPostgresPool()
  // Prefer the primary resume; fall back to the most recent parsed one — matches
  // how the scorer resolves the resume it scores against.
  const { rowCount } = await pool.query(
    `UPDATE resumes
        SET target_field = $2, updated_at = now()
      WHERE id = (
        SELECT id FROM resumes
         WHERE user_id = $1 AND archived_at IS NULL AND parse_status = 'complete'
         ORDER BY is_primary DESC, updated_at DESC
         LIMIT 1
      )`,
    [user.id, target],
  )
  if (!rowCount) return NextResponse.json({ error: "No parsed resume to position" }, { status: 404 })

  return NextResponse.json({ ok: true, targetField: target }, { headers: { "Cache-Control": "no-store" } })
}
