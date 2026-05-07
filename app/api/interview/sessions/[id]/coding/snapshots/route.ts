import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres/server"

export const runtime = "nodejs"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const pool = getPostgresPool()
  const result = await pool.query<{
    code_snapshots: Array<{ ts: number; code: string }>
    language_used: string
    final_code: string | null
    solve_time_sec: number | null
  }>(
    `SELECT ca.code_snapshots, ca.language_used, ca.final_code, ca.solve_time_sec
     FROM coding_attempts ca
     JOIN interview_sessions s ON s.id = ca.session_id
     WHERE s.id = $1 AND s.user_id = $2
     LIMIT 1`,
    [id, user.id]
  )

  if (!result.rows[0]) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const { code_snapshots, language_used, final_code, solve_time_sec } = result.rows[0]
  return NextResponse.json({
    snapshots: code_snapshots ?? [],
    language: language_used,
    finalCode: final_code,
    solveTimeSec: solve_time_sec,
  })
}
