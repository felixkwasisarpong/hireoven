import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getInterviewSession, getDebrief } from "@/lib/scout/interview/queries"
import { generateDebrief } from "@/lib/scout/interview/debriefGenerator"

export const runtime = "nodejs"
export const maxDuration = 60

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const session = await getInterviewSession(id, user.id)
  if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 })

  let debrief = await getDebrief(id)

  // Auto-generate on first GET if stub or missing
  if (!debrief || debrief.overallScore === null) {
    if (session.status !== "completed") {
      if (!debrief) return NextResponse.json({ error: "Debrief not yet available" }, { status: 404 })
      return NextResponse.json({ debrief, session })
    }
    try {
      debrief = await generateDebrief(id)
    } catch (e) {
      console.error("[debrief GET] generation failed:", e)
      if (debrief) return NextResponse.json({ debrief, session })
      return NextResponse.json({ error: "Debrief generation failed" }, { status: 500 })
    }
  }

  return NextResponse.json({ debrief, session })
}
