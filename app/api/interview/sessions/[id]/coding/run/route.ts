import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres/server"

export const runtime = "nodejs"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json().catch(() => ({})) as {
    testResults?: {
      passed: number
      failed: number
      totalWeight: number
      passedCount: number
      failedCount: number
      errors: unknown[]
      runtimeMs: number
    }
    isSubmit?: boolean
  }

  const pool = getPostgresPool()

  // Verify ownership
  const attempt = await pool.query<{ id: string; created_at: string }>(
    `SELECT ca.id, ca.created_at
     FROM coding_attempts ca
     JOIN interview_sessions s ON s.id = ca.session_id
     WHERE s.id = $1 AND s.user_id = $2
     LIMIT 1`,
    [id, user.id]
  )

  if (!attempt.rows[0]) return NextResponse.json({ ok: true })

  if (body.isSubmit && body.testResults) {
    const startedAt = new Date(attempt.rows[0].created_at).getTime()
    const solveTimeSec = Math.floor((Date.now() - startedAt) / 1000)

    await pool.query(
      `UPDATE coding_attempts
       SET test_results = $1::jsonb,
           submitted_at = NOW(),
           solve_time_sec = $2
       WHERE id = $3`,
      [JSON.stringify(body.testResults), solveTimeSec, attempt.rows[0].id]
    )
  }

  return NextResponse.json({ ok: true })
}
