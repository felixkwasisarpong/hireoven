import { NextResponse } from "next/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const monthStart = new Date()
  monthStart.setUTCDate(1)
  monthStart.setUTCHours(0, 0, 0, 0)

  const pool = getPostgresPool()

  const [coverLetters, analyses] = await Promise.all([
    pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM cover_letters
       WHERE user_id = $1
         AND created_at >= $2`,
      [user.id, monthStart.toISOString()]
    ),
    pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM resume_analyses
       WHERE user_id = $1
         AND created_at >= $2`,
      [user.id, monthStart.toISOString()]
    ),
  ])

  return NextResponse.json({
    cover_letters_used: Number(coverLetters.rows[0]?.count ?? 0),
    analyses_used: Number(analyses.rows[0]?.count ?? 0),
  })
}
