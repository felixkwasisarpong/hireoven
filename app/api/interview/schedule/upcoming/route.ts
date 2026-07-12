import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { listUpcomingScheduledSessions } from "@/lib/interview/scheduling"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// GET /api/interview/schedule/upcoming — the user's booked live interviews,
// soonest first. Powers the hub list and the in-app reminder watcher.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const sessions = await listUpcomingScheduledSessions(user.id)
    return NextResponse.json({
      sessions: sessions.map((s) => ({
        id: s.id,
        scheduledAt: s.scheduledAt.toISOString(),
        scheduledTimezone: s.scheduledTimezone,
        durationTargetMin: s.durationTargetMin,
        persona: s.persona,
        questionSet: s.questionSet,
        jobTitle: s.jobTitle,
        jobCompany: s.jobCompany,
      })),
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to list upcoming interviews" },
      { status: 500 }
    )
  }
}
