import { NextRequest, NextResponse } from "next/server"
import { sqlJobLocatedInUsa } from "@/lib/jobs/usa-job-sql"
import { getPostgresPool } from "@/lib/postgres/server"
import { createClient } from "@/lib/supabase/server"
import { formatEmploymentLabel, formatSalaryLabel } from "@/lib/jobs/normalization/view-model"
import type { Job, JobMatchScore } from "@/types"

const FAST_SCORE_ALGORITHM_UPDATED_AT = "2026-05-14T00:00:00.000Z"

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
  const titles = sp.get("titles")?.split(",").map((t) => t.trim()).filter(Boolean)
  const within = sp.get("within") ?? "all"
  const since = sp.get("since")?.trim()
  const sort = sp.get("sort") ?? "fresh"
  const limit = Math.min(250, parseInt(sp.get("limit") ?? "24", 10))
  const offset = parseInt(sp.get("offset") ?? "0", 10)
  const withScores = sp.get("withScores") === "1" || sp.get("with_scores") === "1"

  // Pass companyAlias so the predicate's H1B-rescue path can admit
  // null-location remote jobs from US H1B-sponsoring employers (Nestle USA,
  // UT Houston, etc.) while still rejecting null-loc remotes from companies
  // with no US-sponsorship evidence.
  const where: string[] = ["jobs.is_active = true", sqlJobLocatedInUsa("jobs", { companyAlias: "companies" })]
  const values: Array<string | number | boolean | string[]> = []

  const addParam = (value: string | number | boolean | string[]) => {
    values.push(value)
    return `$${values.length}`
  }

  if (q?.trim()) {
    // Match on title, normalized_title, skills array, OR company name —
    // mirrors the broader matching in /api/match/feed so the two routes
    // return the same candidate pool for the same `q`. The previous
    // title-only ILIKE diverged: ?q=java&sort=freshest missed jobs that
    // had Java in their skills/company but not in the literal title.
    const pattern = `%${q.trim()}%`
    const p = addParam(pattern)
    where.push(`(
      jobs.title ILIKE ${p}
      OR jobs.normalized_title ILIKE ${p}
      OR companies.name ILIKE ${p}
      OR EXISTS (SELECT 1 FROM unnest(jobs.skills) s WHERE s ILIKE ${p})
    )`)
  }
  if (companyId) where.push(`jobs.company_id = ${addParam(companyId)}`)
  if (remote) where.push("jobs.is_remote = true")
  if (sponsorship) where.push("(jobs.sponsors_h1b = true OR jobs.sponsorship_score > 60)")
  if (seniority?.length) where.push(`jobs.seniority_level = ANY(${addParam(seniority)}::text[])`)
  if (empType?.length) where.push(`jobs.employment_type = ANY(${addParam(empType)}::text[])`)
  if (titles?.length) {
    // OR across the selected titles. Substring match because cleaned
    // user-facing titles ("Registered Nurse") often appear inside longer
    // raw titles ("Registered Nurse — Per Diem · ICU").
    const patterns = titles.map((t) => `%${t}%`)
    const pat = addParam(patterns)
    where.push(`(
      jobs.normalized_title ILIKE ANY(${pat}::text[])
      OR jobs.title ILIKE ANY(${pat}::text[])
    )`)
  }
  if (since) {
    where.push(`jobs.first_detected_at >= ${addParam(since)}`)
  } else if (within !== "all" && WITHIN_MS[within]) {
    const cutoff = new Date(Date.now() - WITHIN_MS[within]).toISOString()
    where.push(`jobs.first_detected_at >= ${addParam(cutoff)}`)
  }

  // `sort=match` without a personalized feed isn't meaningful here — the
  // route doesn't have a per-user resume context to compute scores. Fall
  // back to freshness so we don't accidentally order by sponsorship_score
  // (the previous, surprising behaviour). The match-aware sort happens
  // in /api/match/feed; the client routes there when the user has a
  // primary resume.
  const orderBy = "jobs.first_detected_at DESC NULLS LAST"
  const pool = getPostgresPool()
  const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString()

  try {
    // Snapshot WHERE-only params before appending limit/offset so the count
    // query (no LIMIT/OFFSET) doesn't get extra unused $N params bound.
    const whereOnlyValues = [...values]
    const limitParam = addParam(limit)
    const offsetParam = addParam(offset)

    // Run main fetch + both counts in parallel. The previous query used
    // `COUNT(*) OVER()` which forced full materialization of the filtered set
    // (~2.5s on 113K matching rows). With idx_jobs_us_ca_active_freshest the
    // separate COUNT is index-only and effectively free.
    const [jobsResult, totalCountResult, newInLastHourResult] = await Promise.all([
      pool.query<Record<string, unknown> & { company: unknown }>(
        `SELECT jobs.*,
                to_jsonb(companies.*) AS company,
                gjs.risk_score AS ghost_risk_score,
                gjs.risk_level AS ghost_risk_level
         FROM jobs
         LEFT JOIN companies ON companies.id = jobs.company_id
         LEFT JOIN ghost_job_scores gjs ON gjs.job_id = jobs.id
         WHERE ${where.join(" AND ")}
         ORDER BY ${orderBy}
         LIMIT ${limitParam}
         OFFSET ${offsetParam}`,
        values
      ),
      pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM jobs
         LEFT JOIN companies ON companies.id = jobs.company_id
         WHERE ${where.join(" AND ")}`,
        whereOnlyValues
      ),
      pool.query<{ count: string }>(
        // Mirror the main feed predicate (including companies join) so the
        // "new in last hour" count matches what users actually see in the feed.
        `SELECT COUNT(*)::text AS count
         FROM jobs
         LEFT JOIN companies ON companies.id = jobs.company_id
         WHERE jobs.is_active = true
           AND ${sqlJobLocatedInUsa("jobs", { companyAlias: "companies" })}
           AND jobs.first_detected_at >= $1`,
        [oneHourAgo]
      ),
    ])

    const jobs = jobsResult.rows
    const total = Number(totalCountResult.rows[0]?.count ?? 0)
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

    const jobsWithCardView = jobs.map((job: unknown) => {
      const j = job as Job
      return {
        ...j,
        card_view: {
          title: j.title,
          location: j.location ?? null,
          salary_label: formatSalaryLabel(j.salary_min, j.salary_max, j.salary_currency) ?? null,
          employment_label: formatEmploymentLabel(j.employment_type) ?? null,
          seniority_label: null,
          preview_description: null,
          skills: j.skills ?? [],
          skill_groups: null,
          sponsorship_badge: null,
          visa_card_label: null,
          show_visa_drawer: false,
        },
      }
    })
    return NextResponse.json({ jobs: jobsWithCardView, total, newInLastHour })
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
