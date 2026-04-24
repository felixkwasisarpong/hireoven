import { NextResponse } from "next/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { createClient } from "@/lib/supabase/server"

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const pool = getPostgresPool()

  const body = (await request.json().catch(() => ({}))) as {
    reason?: string
    details?: string
  }

  const latestResult = await pool.query<{ id: string }>(
    `SELECT id
     FROM subscriptions
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [user.id]
  )
  const latest = latestResult.rows[0]

  if (!latest?.id) {
    return NextResponse.json({ error: "Subscription not found" }, { status: 404 })
  }

  await pool.query(
    `UPDATE subscriptions
     SET cancellation_feedback = $1::jsonb,
         updated_at = $2
     WHERE id = $3`,
    [
      JSON.stringify({
        reason: body.reason ?? null,
        details: body.details ?? null,
        submitted_at: new Date().toISOString(),
      }),
      new Date().toISOString(),
      latest.id,
    ]
  )

  return NextResponse.json({ ok: true })
}
