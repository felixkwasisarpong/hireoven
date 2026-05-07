import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { getInterviewSession } from "@/lib/scout/interview/queries"

export const runtime = "nodejs"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const session = await getInterviewSession(id, user.id)
    if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 })
    // Attach metadata for practice_focus and other per-session annotations
    const pool = getPostgresPool()
    const metaResult = await pool.query<{ metadata: Record<string, unknown> }>(
      `SELECT metadata FROM interview_sessions WHERE id = $1`,
      [id]
    )
    const metadata = metaResult.rows[0]?.metadata ?? {}
    return NextResponse.json({ session: { ...session, metadata } })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch session" },
      { status: 500 }
    )
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json().catch(() => ({})) as { status?: string }
  const { status } = body

  if (!["active", "completed", "abandoned"].includes(status ?? "")) {
    return NextResponse.json(
      { error: "status must be active, completed, or abandoned" },
      { status: 400 }
    )
  }

  const pool = getPostgresPool()

  // Verify ownership
  const check = await pool.query<{ id: string }>(
    `SELECT id FROM interview_sessions WHERE id = $1 AND user_id = $2`,
    [id, user.id]
  )
  if (check.rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  await pool.query(
    `UPDATE interview_sessions
     SET status = $2,
         started_at = CASE WHEN $2 = 'active' AND started_at IS NULL THEN NOW() ELSE started_at END,
         ended_at   = CASE WHEN $2 IN ('completed', 'abandoned') AND ended_at IS NULL THEN NOW() ELSE ended_at END
     WHERE id = $1 AND user_id = $3`,
    [id, status, user.id]
  )

  return NextResponse.json({ ok: true })
}
