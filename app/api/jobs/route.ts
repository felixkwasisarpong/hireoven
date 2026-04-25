import { NextRequest, NextResponse } from "next/server"
import { sqlJobLocatedInUsa } from "@/lib/jobs/usa-job-sql"
import { getPostgresPool } from "@/lib/postgres/server"
import { createClient } from "@/lib/supabase/server"
import type { JobMatchScore } from "@/types"

const FAST_SCORE_ALGORITHM_UPDATED_AT = "2026-04-24T23:45:00.000Z"

const WITHIN_MS: Record<string, number> = {
  "1h": 3_600_000,
  "6h": 21_600_000,
  "24h": 86_400_000,
  "3d": 259_200_000,
  "7d": 604_800_000,
}

export async function GET(request: NextRequest) {
  const sp = new URL(request.url).searchParams
  const q = sp.get("q")
  const companyId = sp.get("company_id")
  const seniority = sp.get("seniority")?.split(",").filter(Boolean)
  const empType = sp.get("employment_type")?.split(",").filter(Boolean)
  const remote = sp.get("remote") === "true"
  const sponsorship = sp.get("sponsorship") === "true"
  const within = sp.get("within") ?? "all"
  const since = sp.get("since")?.trim()
  const sort = sp.get("sort") ?? "fresh"
  const limit = Math.min(250, parseInt(sp.get("limit") ?? "24", 10))
  const offset = parseInt(sp.get("offset") ?? "0", 10)
  const withScores = sp.get("withScores") === "1" || sp.get("with_scores") === "1"

  const where: string[] = ["jobs.is_active = true", sqlJobLocatedInUsa("jobs")]
  const values: Array<string | number | boolean | string[]> = []

  const addParam = (value: string | number | boolean | string[]) => {
    values.push(value)
    return `$${values.length}`
  }

  if (q?.trim()) where.push(`jobs.title ILIKE ${addParam(`%${q.trim()}%`)}`)
  if (companyId) where.push(`jobs.company_id = ${addParam(companyId)}`)
  if (remote) where.push("jobs.is_remote = true")
  if (sponsorship) where.push("(jobs.sponsors_h1b = true OR jobs.sponsorship_score > 60)")
  if (seniority?.length) where.push(`jobs.seniority_level = ANY(${addParam(seniority)}::text[])`)
  if (empType?.length) where.push(`jobs.employment_type = ANY(${addParam(empType)}::text[])`)
  if (since) {
    where.push(`jobs.first_detected_at >= ${addParam(since)}`)
  } else if (within !== "all" && WITHIN_MS[within]) {
    const cutoff = new Date(Date.now() - WITHIN_MS[within]).toISOString()
    where.push(`jobs.first_detected_at >= ${addParam(cutoff)}`)
  }

  const orderBy =
    sort === "match" ? "jobs.sponsorship_score DESC NULLS LAST" : "jobs.first_detected_at DESC NULLS LAST"
  const pool = getPostgresPool()
  const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString()

  try {
    const limitParam = addParam(limit)
    const offsetParam = addParam(offset)

    const [jobsResult, newInLastHourResult] = await Promise.all([
      pool.query<Record<string, unknown> & { company: unknown; total_count: string }>(
        `SELECT jobs.*, to_jsonb(companies.*) AS company, COUNT(*) OVER()::text AS total_count
         FROM jobs
         LEFT JOIN companies ON companies.id = jobs.company_id
         WHERE ${where.join(" AND ")}
         ORDER BY ${orderBy}
         LIMIT ${limitParam}
         OFFSET ${offsetParam}`,
        values
      ),
      pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM jobs WHERE is_active = true AND ${sqlJobLocatedInUsa(
          "jobs"
        )} AND first_detected_at >= $1`,
        [oneHourAgo]
      ),
    ])

    const jobs = jobsResult.rows.map(({ total_count: _ignore, ...row }) => row)
    const total = Number(jobsResult.rows[0]?.total_count ?? 0)
    const newInLastHour = Number(newInLastHourResult.rows[0]?.count ?? 0)

    if (withScores && jobs.length > 0) {
      try {
        const supabase = await createClient()
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (user) {
          const jobIds = jobs.map((j) => j.id as string)
          const scoresResult = await pool.query<JobMatchScore & { user_id: string }>(
            `SELECT s.*
               FROM job_match_scores s
               INNER JOIN resumes r
                 ON r.id = s.resume_id
                AND r.user_id = s.user_id
                AND r.is_primary = true
                AND r.parse_status = 'complete'
              WHERE s.user_id = $1
                AND s.job_id = ANY($2::uuid[])
                AND s.computed_at >= r.updated_at
                AND s.computed_at >= $3::timestamptz`,
            [user.id, jobIds, FAST_SCORE_ALGORITHM_UPDATED_AT]
          )
          const byJobId = new Map<string, JobMatchScore>()
          for (const row of scoresResult.rows) {
            byJobId.set(row.job_id, row)
          }
          for (const job of jobs) {
            const existing = byJobId.get(job.id as string)
            if (existing) {
              ;(job as Record<string, unknown>).match_score = existing
            }
          }
        }
      } catch (scoreErr) {
        console.warn("Failed to embed match scores in /api/jobs", scoreErr)
      }
    }

    return NextResponse.json({ jobs, total, newInLastHour })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Database query failed" },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json()
  const pool = getPostgresPool()

  try {
    const columns = Object.keys(body)
    if (columns.length === 0) {
      return NextResponse.json({ error: "Request body is required" }, { status: 400 })
    }
    if (!columns.every((col) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(col))) {
      return NextResponse.json({ error: "Invalid column name in request body" }, { status: 400 })
    }

    const values = Object.values(body)
    const placeholders = values.map((_, i) => `$${i + 1}`).join(", ")
    const quotedColumns = columns.map((col) => `"${col}"`).join(", ")

    const result = await pool.query<Record<string, unknown>>(
      `INSERT INTO jobs (${quotedColumns}) VALUES (${placeholders}) RETURNING *`,
      values
    )

    return NextResponse.json({ job: result.rows[0] }, { status: 201 })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to insert job" },
      { status: 500 }
    )
  }
}
