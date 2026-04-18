import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { scoreJobsForUser, getScoringContextForUser } from "@/lib/matching/batch-scorer"
import { createClient } from "@/lib/supabase/server"
import type { JobMatchScore } from "@/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const jobId = request.nextUrl.searchParams.get("jobId")

    if (!jobId) {
      return NextResponse.json({ error: "jobId is required" }, { status: 400 })
    }

    const context = await getScoringContextForUser(user.id)
    if (!context) {
      return NextResponse.json({ score: null })
    }

    const admin = createAdminClient()
    const { data: existing } = await admin
      .from("job_match_scores")
      .select("*")
      .eq("user_id", user.id)
      .eq("resume_id", context.resume.id)
      .eq("job_id", jobId)
      .maybeSingle()

    if (existing) {
      return NextResponse.json({ score: existing as JobMatchScore })
    }

    const scores = await scoreJobsForUser(user.id, [jobId])
    return NextResponse.json({ score: scores.get(jobId) ?? null })
  } catch (error) {
    console.error("Failed to score job", error)
    return NextResponse.json(
      { error: "Match scoring is not available. Check the job_match_scores migration." },
      { status: 503 }
    )
  }
}
