import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { appendTurn, getTurns, upsertDebrief } from "@/lib/scout/interview/queries"

export const runtime = "nodejs"

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const pool = getPostgresPool()

  // Ownership + status check
  const check = await pool.query<{ status: string }>(
    `SELECT status FROM interview_sessions WHERE id = $1 AND user_id = $2`,
    [id, user.id]
  )
  if (check.rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  const { status } = check.rows[0]
  if (status === "completed" || status === "abandoned") {
    return NextResponse.json({ error: "Session is already ended" }, { status: 400 })
  }

  // Mark completed
  await pool.query(
    `UPDATE interview_sessions SET status = 'completed', ended_at = NOW() WHERE id = $1 AND user_id = $2`,
    [id, user.id]
  )

  // Save end system turn
  const existingTurns = await getTurns(id)
  await appendTurn({
    sessionId: id,
    turnIndex: existingTurns.length,
    role: "system",
    content: "Interview ended early by candidate.",
  })

  // Stub debrief — chunk 6 will replace this with real generation
  await upsertDebrief({
    sessionId: id,
    overallScore: null,
    headline: "Debrief pending",
    strengths: [],
    gaps: [],
    sampleBetterAnswers: [],
    recommendedNext: [],
  })

  return NextResponse.json({
    ok: true,
    debriefUrl: `/dashboard/interview/${id}/debrief`,
  })
}
