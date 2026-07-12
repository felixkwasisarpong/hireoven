import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getInterviewSession } from "@/lib/apex/interview/queries"
import { buildInterviewIcs, getJobContext } from "@/lib/interview/scheduling"
import { resolveAppOrigin } from "@/lib/app-url"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// GET /api/interview/sessions/[id]/calendar.ics — downloadable calendar event
// for a scheduled live interview.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const session = await getInterviewSession(id, user.id)
  if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (!session.scheduledAt) {
    return NextResponse.json({ error: "Session has no scheduled time" }, { status: 400 })
  }

  const { jobTitle, jobCompany } = await getJobContext(session.jobId)

  const ics = buildInterviewIcs({
    sessionId: session.id,
    scheduledAt: session.scheduledAt,
    durationMin: session.durationTargetMin,
    joinUrl: `${resolveAppOrigin(request)}/dashboard/interview/live/${session.id}`,
    jobTitle,
    jobCompany,
  })

  return new NextResponse(ics, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="hireoven-interview-${session.id.slice(0, 8)}.ics"`,
      "Cache-Control": "no-store",
    },
  })
}
