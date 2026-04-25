import { NextRequest, NextResponse } from "next/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { scoreJobsForUser, getScoringContextForUser } from "@/lib/matching/batch-scorer"
import { createClient } from "@/lib/supabase/server"
import type { JobMatchScore } from "@/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const FAST_SCORE_ALGORITHM_UPDATED_AT = new Date("2026-04-24T23:45:00.000Z").getTime()

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

    const pool = getPostgresPool()
    const existingResult = await pool.query<JobMatchScore>(
      `SELECT *
       FROM job_match_scores
       WHERE user_id = $1
         AND resume_id = $2
         AND job_id = $3
       LIMIT 1`,
      [user.id, context.resume.id, jobId]
    )
    const existing = existingResult.rows[0]

    const existingComputedAt = existing ? new Date(existing.computed_at).getTime() : 0
    const resumeUpdatedAt = new Date(context.resume.updated_at).getTime()
    if (
      existing &&
      Number.isFinite(existingComputedAt) &&
      existingComputedAt >= resumeUpdatedAt &&
      existingComputedAt >= FAST_SCORE_ALGORITHM_UPDATED_AT
    ) {
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
