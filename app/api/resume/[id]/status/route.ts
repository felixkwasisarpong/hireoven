import { NextResponse } from "next/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { createClient } from "@/lib/supabase/server"

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const pool = getPostgresPool()
  const result = await pool.query<{ parse_status: string; parse_error: string | null; resume_score: number | null; ats_score: number | null }>(
    `SELECT parse_status, parse_error, resume_score, ats_score
     FROM resumes
     WHERE id = $1
       AND user_id = $2
     LIMIT 1`,
    [params.id, user.id]
  )
  const data = result.rows[0]

  if (!data) {
    return NextResponse.json({ error: "Resume not found" }, { status: 404 })
  }

  return NextResponse.json(data)
}
