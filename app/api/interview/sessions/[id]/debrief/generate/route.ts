import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getInterviewSession } from "@/lib/scout/interview/queries"
import { generateDebrief } from "@/lib/scout/interview/debriefGenerator"

export const runtime = "nodejs"
export const maxDuration = 60

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const session = await getInterviewSession(id, user.id)
  if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (session.status !== "completed") {
    return NextResponse.json({ error: "Session must be completed to generate debrief" }, { status: 400 })
  }

  const body = await request.json().catch(() => ({})) as { force?: boolean }

  try {
    const debrief = await generateDebrief(id, { force: body.force ?? false })
    return NextResponse.json({ debrief })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Generation failed" },
      { status: 500 }
    )
  }
}
