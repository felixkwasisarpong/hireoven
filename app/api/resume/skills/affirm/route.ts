import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// The user affirms skills they actually have (from the feed's skill-boost card).
// We append them to the primary résumé's top_skills and bump updated_at, which
// re-scores the feed — so affirming a skill immediately improves matches. Only
// skills the user explicitly clicks are added; nothing is inferred.
export async function POST(request: Request) {
  if (!hasPostgresEnv()) return NextResponse.json({ error: "Unavailable" }, { status: 503 })

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = (await request.json().catch(() => ({}))) as { skills?: unknown }
  const skills = Array.isArray(body.skills)
    ? [
        ...new Set(
          body.skills
            .filter((s): s is string => typeof s === "string")
            .map((s) => s.trim())
            .filter((s) => s.length > 0 && s.length <= 60),
        ),
      ].slice(0, 12)
    : []
  if (skills.length === 0) return NextResponse.json({ error: "No skills provided" }, { status: 400 })

  const pool = getPostgresPool()
  // Append case-insensitively de-duplicated skills to the primary résumé, then
  // touch updated_at so the batch scorer re-scores against the fuller profile.
  const { rowCount } = await pool.query(
    `UPDATE resumes
        SET top_skills = ARRAY(
              SELECT DISTINCT s FROM unnest(top_skills || $2::text[]) AS s
            ),
            updated_at = now()
      WHERE id = (
        SELECT id FROM resumes
         WHERE user_id = $1 AND archived_at IS NULL AND parse_status = 'complete'
         ORDER BY is_primary DESC, updated_at DESC
         LIMIT 1
      )`,
    [user.id, skills],
  )
  if (!rowCount) return NextResponse.json({ error: "No parsed resume" }, { status: 404 })

  return NextResponse.json({ ok: true, added: skills }, { headers: { "Cache-Control": "no-store" } })
}
