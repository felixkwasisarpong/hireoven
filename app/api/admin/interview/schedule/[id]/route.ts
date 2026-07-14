import { NextResponse } from "next/server"
import { assertAdminAccess } from "@/lib/admin/auth"
import { getPostgresPool } from "@/lib/postgres/server"
import { updateInterviewSessionStatus } from "@/lib/apex/interview/queries"
import { sendScheduleCancelledEmail } from "@/lib/interview/confirmation-email"

export const runtime = "nodejs"

// DELETE /api/admin/interview/schedule/[id] — admin cancels a user's scheduled
// live interview. Frees the slot, clears pending reminders, and notifies the
// user by email (their credits were never deducted).
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const access = await assertAdminAccess()
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const { id } = await params
  const pool = getPostgresPool()
  const result = await pool.query<{
    id: string
    user_id: string
    type: string
    status: string
    scheduled_at: string | null
    scheduled_timezone: string | null
    duration_target_min: number
  }>(
    `SELECT id, user_id, type, status, scheduled_at, scheduled_timezone, duration_target_min
     FROM interview_sessions
     WHERE id = $1
     LIMIT 1`,
    [id]
  )
  const session = result.rows[0]
  if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (session.type !== "live" || session.status !== "setup" || !session.scheduled_at) {
    return NextResponse.json(
      { error: "Session is not a scheduled live interview" },
      { status: 400 }
    )
  }

  // Also clears the session's unsent reminders.
  await updateInterviewSessionStatus(session.id, "abandoned")

  // Best-effort — the cancellation stands even if the notice fails.
  try {
    await sendScheduleCancelledEmail({
      userId: session.user_id,
      sessionId: session.id,
      scheduledAt: new Date(session.scheduled_at),
      timeZone: session.scheduled_timezone,
      durationMin: session.duration_target_min,
    })
  } catch (err) {
    console.error("[admin] interview cancellation email failed:", err)
  }

  return NextResponse.json({ ok: true })
}
