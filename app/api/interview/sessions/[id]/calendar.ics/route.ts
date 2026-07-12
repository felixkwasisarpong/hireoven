import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { getInterviewSession } from "@/lib/apex/interview/queries"
import { buildInterviewIcs } from "@/lib/interview/scheduling"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function getBaseUrl() {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
}

// GET /api/interview/sessions/[id]/calendar.ics — downloadable calendar event
// for a scheduled live interview.
export async function GET(
  _request: Request,
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

  let jobTitle: string | null = null
  let jobCompany: string | null = null
  if (session.jobId) {
    const pool = getPostgresPool()
    const result = await pool.query<{ title: string | null; company_name: string | null }>(
      `SELECT j.title, c.name AS company_name
       FROM jobs j
       LEFT JOIN companies c ON c.id = j.company_id
       WHERE j.id = $1
       LIMIT 1`,
      [session.jobId]
    )
    jobTitle = result.rows[0]?.title ?? null
    jobCompany = result.rows[0]?.company_name ?? null
  }

  const ics = buildInterviewIcs({
    sessionId: session.id,
    scheduledAt: session.scheduledAt,
    durationMin: session.durationTargetMin,
    joinUrl: `${getBaseUrl()}/dashboard/interview/live/${session.id}`,
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
