import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getInterviewSession, updateInterviewSessionStatus } from "@/lib/apex/interview/queries"
import {
  isValidTimeZone,
  rescheduleScheduledSession,
  resetRemindersForSession,
  validateScheduledAt,
} from "@/lib/interview/scheduling"

export const runtime = "nodejs"

// PATCH /api/interview/sessions/[id]/schedule — reschedule a booked interview.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const session = await getInterviewSession(id, user.id)
  if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (session.type !== "live" || session.status !== "setup" || !session.scheduledAt) {
    return NextResponse.json({ error: "Session is not a scheduled live interview" }, { status: 400 })
  }

  const body = await request.json().catch(() => ({})) as { scheduledAt?: string; timezone?: string }
  const validated = validateScheduledAt(body.scheduledAt)
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 })

  const timezone = body.timezone && isValidTimeZone(body.timezone) ? body.timezone : session.scheduledTimezone

  try {
    const result = await rescheduleScheduledSession({
      sessionId: session.id,
      userId: user.id,
      durationTargetMin: session.durationTargetMin,
      scheduledAt: validated.scheduledAt,
      scheduledTimezone: timezone,
    })
    if (!result.ok) {
      return NextResponse.json(
        { error: "That time slot is fully booked — pick another slot" },
        { status: 409 }
      )
    }
    try {
      await resetRemindersForSession(session.id, user.id, validated.scheduledAt)
    } catch (err) {
      console.error("[interview] reminder reset failed on reschedule:", err)
    }
    return NextResponse.json({ ok: true, scheduledAt: validated.scheduledAt.toISOString() })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to reschedule" },
      { status: 500 }
    )
  }
}

// DELETE /api/interview/sessions/[id]/schedule — cancel a booked interview.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const session = await getInterviewSession(id, user.id)
  if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (session.type !== "live" || session.status !== "setup" || !session.scheduledAt) {
    return NextResponse.json({ error: "Session is not a scheduled live interview" }, { status: 400 })
  }

  try {
    // updateInterviewSessionStatus also clears the session's unsent reminders.
    await updateInterviewSessionStatus(session.id, "abandoned")
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to cancel" },
      { status: 500 }
    )
  }
}
