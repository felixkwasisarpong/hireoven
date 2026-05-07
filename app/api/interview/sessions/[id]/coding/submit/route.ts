import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { upsertDebrief, appendTurn, getTurns } from "@/lib/scout/interview/queries"

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
    finalCode?: string
    testResults?: {
      passed: number
      failed: number
      totalWeight: number
      passedCount: number
      failedCount: number
      errors: unknown[]
      runtimeMs: number
    }
    languageUsed?: "python" | "javascript" | "typescript"
  }

  const pool = getPostgresPool()

  // Verify ownership + get attempt
  const attemptResult = await pool.query<Record<string, unknown>>(
    `SELECT ca.id, ca.created_at, ca.hints_used
     FROM coding_attempts ca
     JOIN interview_sessions s ON s.id = ca.session_id
     WHERE s.id = $1 AND s.user_id = $2 AND s.status != 'abandoned'
     LIMIT 1`,
    [id, user.id]
  )
  if (!attemptResult.rows[0]) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const attempt = attemptResult.rows[0]
  const startedAt = new Date(attempt.created_at as string).getTime()
  const solveTimeSec = Math.floor((Date.now() - startedAt) / 1000)

  // Save submission
  await pool.query(
    `UPDATE coding_attempts
     SET final_code = $1,
         test_results = $2::jsonb,
         hints_used = COALESCE(hints_used, 0),
         solve_time_sec = $3,
         submitted_at = NOW(),
         language_used = COALESCE($4::coding_language, language_used)
     WHERE id = $5`,
    [
      body.finalCode ?? "",
      JSON.stringify(body.testResults ?? {}),
      solveTimeSec,
      body.languageUsed ?? null,
      attempt.id as string,
    ]
  )

  // Mark session completed
  await pool.query(
    `UPDATE interview_sessions SET status = 'completed', ended_at = NOW() WHERE id = $1 AND user_id = $2`,
    [id, user.id]
  )

  // Compute correctness score
  const tr = body.testResults
  const score = tr && tr.totalWeight > 0
    ? Math.round((tr.passed / tr.totalWeight) * 100)
    : 0

  // Stub debrief — chunk 6 replaces with real analysis
  await upsertDebrief({
    sessionId: id,
    overallScore: score,
    headline: "Coding test complete",
    strengths: [],
    gaps: [],
    sampleBetterAnswers: [],
    codingFeedback: {
      score,
      passed: tr?.passed ?? 0,
      failed: tr?.failed ?? 0,
      totalWeight: tr?.totalWeight ?? 0,
      runtimeMs: tr?.runtimeMs ?? 0,
    },
    recommendedNext: [],
  })

  // Append system turn for walkthrough
  const turns = await getTurns(id)
  await appendTurn({
    sessionId: id,
    turnIndex: turns.length,
    role: "system",
    content: `Solution submitted. Score: ${score}%. Time: ${Math.floor(solveTimeSec / 60)}m ${solveTimeSec % 60}s.`,
  })

  return NextResponse.json({ debriefUrl: `/dashboard/interview/${id}/debrief` })
}
