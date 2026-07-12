import { NextResponse } from "next/server"
import { assertAdminAccess } from "@/lib/admin/auth"
import { adminListUpcomingScheduled } from "@/lib/interview/scheduling"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// GET /api/admin/interview/schedule — all users' upcoming scheduled live
// interviews for the admin console.
export async function GET() {
  const access = await assertAdminAccess()
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const sessions = await adminListUpcomingScheduled()
  return NextResponse.json({
    sessions: sessions.map((s) => ({
      id: s.id,
      userId: s.userId,
      userEmail: s.userEmail,
      userName: s.userName,
      scheduledAt: s.scheduledAt.toISOString(),
      scheduledTimezone: s.scheduledTimezone,
      durationTargetMin: s.durationTargetMin,
      persona: s.persona,
      questionSet: s.questionSet,
      jobTitle: s.jobTitle,
      jobCompany: s.jobCompany,
      remindersSent: s.remindersSent,
      createdAt: s.createdAt.toISOString(),
    })),
  })
}
