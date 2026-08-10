import { NextRequest, NextResponse } from "next/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { computeFastScore, getResumeVersion } from "@/lib/matching/fast-scorer"
import { getScoringContextForUser, upsertMatchScores } from "@/lib/matching/batch-scorer"
import { isScoreFreshForResume } from "@/lib/matching/score-freshness"
import { createClient } from "@/lib/supabase/server"
import type { Job, JobMatchScore } from "@/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type ExistingScoreRow = JobMatchScore & { resume_updated_at: string }

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const jobId = request.nextUrl.searchParams.get("jobId")
    if (!jobId) return NextResponse.json({ error: "jobId is required" }, { status: 400 })

    const context = await getScoringContextForUser(user.id)
    if (!context) return NextResponse.json({ score: null })

    const pool = getPostgresPool()
    const currentVersion = getResumeVersion(context.resume)

    // Fetch job and existing cached score in parallel
    const [jobResult, existingResult] = await Promise.all([
      pool.query<Job>("SELECT * FROM jobs WHERE id = $1 LIMIT 1", [jobId]),
      pool.query<ExistingScoreRow>(
        `SELECT jms.*, r.updated_at AS resume_updated_at
         FROM job_match_scores jms
         JOIN resumes r
           ON r.id = jms.resume_id
          AND r.user_id = jms.user_id
         WHERE jms.user_id = $1 AND jms.resume_id = $2 AND jms.job_id = $3
         LIMIT 1`,
        [user.id, context.resume.id, jobId]
      ),
    ])

    const job = jobResult.rows[0]
    if (!job) return NextResponse.json({ score: null })

    const existing = existingResult.rows[0]

    // Return cached score if it's still fresh (same resume version + after algorithm bump)
    if (existing && isScoreFreshForResume({
      computedAt: existing.computed_at,
      resumeUpdatedAt: existing.resume_updated_at,
      scoreResumeVersion: existing.resume_version,
      currentResumeVersion: currentVersion,
    })) {
      return NextResponse.json({ score: existing })
    }

    // Compute fresh, upsert, return
    const scoreInsert = computeFastScore({
      resume: context.resume,
      job,
      profile: context.profile,
      targetField: context.resume.target_field,
    })
    const [saved] = await upsertMatchScores([scoreInsert])

    // Attach score_breakdown (not in DB schema) so callers get skill pills
    return NextResponse.json({ score: { ...saved, score_breakdown: scoreInsert.score_breakdown } })
  } catch (error) {
    console.error("[match/score] failed:", error)
    const isDev = process.env.NODE_ENV !== "production"
    return NextResponse.json(
      {
        error: "Match scoring unavailable.",
        ...(isDev && {
          detail: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        }),
      },
      { status: 503 }
    )
  }
}
