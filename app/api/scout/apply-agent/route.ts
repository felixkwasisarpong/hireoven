/**
 * GET /api/scout/apply-agent?minMatchScore=80&count=5&sponsorship=true&workMode=remote
 *
 * Selects jobs from the live feed pool (recently added, active jobs) that match
 * the user's criteria and match score. Excludes jobs already applied to.
 *
 * Safety: read-only. Never modifies application state.
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres/server"
import type { ApplyAgentJob } from "@/lib/scout/apply-agent/types"

export const runtime = "nodejs"

type JobRow = {
  id:           string
  title:        string
  company_name: string | null
  apply_url:    string | null
  location:     string | null
  is_remote:    boolean
  sponsors_h1b: boolean | null
  match_score:  number | null
}

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = request.nextUrl
  const minMatchScore      = Number(searchParams.get("minMatchScore") ?? 0)
  const count              = Math.min(Number(searchParams.get("count") ?? 5), 20)
  const requireSponsorship = searchParams.get("sponsorship") === "true"
  const workMode           = searchParams.get("workMode") ?? null

  const pool = getPostgresPool()

  const conditions: string[] = [
    "j.is_active = true",
    "j.apply_url IS NOT NULL",
    // Only recently added jobs (last 30 days)
    "j.first_detected_at >= NOW() - INTERVAL '30 days'",
    // Exclude jobs user has already applied to or rejected
    `NOT EXISTS (
       SELECT 1 FROM job_applications ja
       WHERE ja.job_id = j.id
         AND ja.user_id = $1
         AND ja.status NOT IN ('saved')
         AND ja.is_archived = false
     )`,
  ]
  const params: unknown[] = [user.id]

  if (minMatchScore > 0) {
    params.push(minMatchScore)
    conditions.push(`jms.overall_score >= $${params.length}`)
  }

  if (requireSponsorship) {
    conditions.push("c.sponsors_h1b = true")
  }

  if (workMode === "remote") {
    conditions.push("j.is_remote = true")
  }

  const where = conditions.join(" AND ")

  try {
    const { rows } = await pool.query<JobRow>(
       `SELECT
         j.id,
         j.title,
         COALESCE(c.name, 'Unknown Company') AS company_name,
         j.apply_url,
         j.location,
         j.is_remote,
         c.sponsors_h1b,
         jms.overall_score AS match_score
       FROM jobs j
       LEFT JOIN companies c ON c.id = j.company_id
       LEFT JOIN LATERAL (
         SELECT overall_score
         FROM job_match_scores
         WHERE user_id = $1 AND job_id = j.id
         ORDER BY computed_at DESC
         LIMIT 1
       ) AS jms ON TRUE
       WHERE ${where}
       ORDER BY jms.overall_score DESC NULLS LAST, j.first_detected_at DESC
       LIMIT $${params.length + 1}`,
      [...params, count],
    )

    const jobs: ApplyAgentJob[] = rows.map((row) => ({
      jobId:             row.id,
      jobTitle:          row.title,
      company:           row.company_name,
      matchScore:        row.match_score,
      applyUrl:          row.apply_url,
      sponsorshipSignal: row.sponsors_h1b === true  ? "Sponsors H-1B"
                       : row.sponsors_h1b === false ? "Does not sponsor"
                       : null,
      location:          row.location,
      isRemote:          row.is_remote,
      status:            "pending",
    }))

    return NextResponse.json({ jobs })
  } catch (error) {
    console.error("[scout/apply-agent] query_failed", {
      userId: user.id,
      error:  error instanceof Error ? error.message : String(error),
    })
    // Never dead-end bulk workflows on selector failures. The chat route can
    // fall back to saved applications when this returns an empty set.
    return NextResponse.json({ jobs: [] })
  }
}
