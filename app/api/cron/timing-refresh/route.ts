import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/env"
import { getPostgresPool } from "@/lib/postgres/server"
import { computeJobTiming } from "@/lib/scout/timing/timing-engine"

export const runtime = "nodejs"
export const maxDuration = 300

type StaleJobRow = {
  id: string
  company_id: string | null
}

const BATCH_SIZE = 100
const CONCURRENCY = 10

export async function GET(request: NextRequest) {
  if (!requireCronAuth(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const pool = getPostgresPool()
  const start = Date.now()

  // Jobs posted in the last 7 days with no score or stale score (>6 hours old)
  const staleResult = await pool.query<StaleJobRow>(
    `SELECT j.id, j.company_id
     FROM jobs j
     WHERE j.posted_at > now() - INTERVAL '7 days'
       AND (
         NOT EXISTS (SELECT 1 FROM job_timing_scores jts WHERE jts.job_id = j.id)
         OR EXISTS (
           SELECT 1 FROM job_timing_scores jts
           WHERE jts.job_id = j.id
             AND jts.computed_at < now() - INTERVAL '6 hours'
         )
       )
     LIMIT $1`,
    [BATCH_SIZE],
  )

  const jobs = staleResult.rows
  let processed = 0
  let failed = 0

  for (let i = 0; i < jobs.length; i += CONCURRENCY) {
    const batch = jobs.slice(i, i + CONCURRENCY)
    await Promise.all(
      batch.map(async (job) => {
        try {
          await computeJobTiming(job.id, job.company_id ?? undefined)
          processed++
        } catch (err) {
          failed++
          console.error("[timing-refresh] failed for job", job.id, err instanceof Error ? err.message : err)
        }
      }),
    )
  }

  const durationMs = Date.now() - start
  console.log("[timing-refresh]", { processed, failed, durationMs, total: jobs.length })

  return NextResponse.json({
    ok: true,
    processed,
    failed,
    total: jobs.length,
    durationMs,
    message: `Timing refresh complete: ${processed} scored, ${failed} failed in ${durationMs}ms`,
  })
}
