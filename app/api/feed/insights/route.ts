import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"
import { getFieldProfiles } from "@/lib/resume/field-profiles"
import { buildFeedInsights } from "@/lib/feed/insights"
import type { Resume } from "@/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Grounded intelligence cards to weave into the job feed for the current user.
// Computed from their primary résumé's field signal against the live-corpus
// demand profiles. Empty ⇒ the feed shows only job cards.
export async function GET() {
  if (!hasPostgresEnv()) return NextResponse.json({ cards: [] })

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const pool = getPostgresPool()
  const { rows } = await pool.query<
    Pick<
      Resume,
      "primary_role" | "top_skills" | "skills" | "work_experience" | "industries" | "summary" | "raw_text"
    >
  >(
    `SELECT primary_role, top_skills, skills, work_experience, industries, summary, raw_text
       FROM resumes
      WHERE user_id = $1 AND archived_at IS NULL AND parse_status = 'complete'
      ORDER BY is_primary DESC, updated_at DESC
      LIMIT 1`,
    [user.id],
  )

  const resume = rows[0]
  if (!resume) return NextResponse.json({ cards: [] })

  const profiles = await getFieldProfiles(pool).catch(() => [])
  const cards = buildFeedInsights(resume, profiles)

  return NextResponse.json({ cards }, { headers: { "Cache-Control": "no-store" } })
}
