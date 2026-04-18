import { NextResponse } from "next/server"
import { scoreJobsForUser } from "@/lib/matching/batch-scorer"
import { createClient } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = (await request.json().catch(() => ({}))) as { jobIds?: string[] }
    const jobIds = Array.from(new Set((body.jobIds ?? []).filter(Boolean)))

    if (jobIds.length === 0) {
      return NextResponse.json({ scores: {} })
    }

    const scores = await scoreJobsForUser(user.id, jobIds)
    return NextResponse.json({ scores: Object.fromEntries(scores.entries()) })
  } catch (error) {
    console.error("Failed to batch score jobs", error)
    return NextResponse.json(
      { error: "Match scoring is not available. Check the job_match_scores migration." },
      { status: 503 }
    )
  }
}
