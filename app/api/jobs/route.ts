import { NextRequest, NextResponse } from "next/server"
import { dedupeFeedJobsBySignature } from "@/lib/jobs/feed-dedupe"
import { sqlJobLocatedInUsa } from "@/lib/jobs/usa-job-sql"
import { scoreJobsForUser } from "@/lib/matching/batch-scorer"
import { hasUsableMatchScore } from "@/lib/jobs/match-score-display"
import { sqlPublishedJob } from "@/lib/jobs/publication"
import { getPostgresPool } from "@/lib/postgres/server"
import { createClient } from "@/lib/supabase/server"
import { formatEmploymentLabel, formatSalaryLabel } from "@/lib/jobs/normalization/view-model"
import type { JobWithCompany, JobWithMatchScore } from "@/types"

const WITHIN_MS: Record<string, number> = {
  "1h": 3_600_000,
  "6h": 21_600_000,
  "24h": 86_400_000,
  "3d": 259_200_000,
  "7d": 604_800_000,
}

type JobWithOptionalCompany = Omit<JobWithCompany, "company"> & {
  company: JobWithCompany["company"] | null
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

  // Keep the global feed on the strict generated location column. Passing a
  // company alias enables the null-location H1B rescue path, but that OR forces
  // Postgres into a multi-million-row scan on the hot feed route.
  const where: string[] = [
    "jobs.is_active = true",
    sqlPublishedJob("jobs"),
    sqlJobLocatedInUsa("jobs"),
  ]
  const values: Array<string | number | boolean | string[]> = []

  const addParam = (value: string | number | boolean | string[]) => {
    values.push(value)
    return `$${values.length}`
  }

  if (q?.trim()) {
    // Tokenize so multi-word queries like "senior backend engineer Java
    // Spring Boot Python" don't require the whole phrase to appear as a
    // single substring (it never does — those words are split across the
    // title and the skills array). Each token must match somewhere in the
    // field group: AND across tokens, OR across fields.
    const tokens = q.trim().split(/\s+/).filter(Boolean)
    for (const token of tokens) {
      const p = addParam(`\\m${token}\\M`)
      where.push(`(
        jobs.title ~* ${p}
        OR jobs.normalized_title ~* ${p}
        OR companies.name ~* ${p}
        OR EXISTS (SELECT 1 FROM unnest(jobs.skills) s WHERE s ~* ${p})
      )`)
    }
  }
  if (companyId) where.push(`jobs.company_id = ${addParam(companyId)}`)
  if (remote) where.push("jobs.is_remote = true")
  if (sponsorship) {
    where.push(`(
      jobs.sponsors_h1b = true
      OR (
        jobs.sponsorship_score > 60
        AND jobs.apply_url NOT ILIKE '%dice.com%'
      )
    )`)
  }
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
    const dbLimit = limit + 1
    const limitParam = addParam(dbLimit)
    const offsetParam = addParam(offset)

    // Avoid exact global counts on the request path. On the production-sized
    // jobs table, COUNT(*) over the feed predicate takes 10s+ under crawler
    // write load. Fetch one extra row instead, enough for pagination affordance.
    const [jobsResult, newInLastHourResult] = await Promise.all([
      pool.query<JobWithOptionalCompany>(
        `SELECT jobs.*,
                to_jsonb(companies.*) AS company,
                gjs.risk_score AS ghost_risk_score,
                gjs.risk_level AS ghost_risk_level,
                gjs.repost_count AS ghost_repost_count
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
        // Mirror the main feed predicate so the "new in last hour" count
        // matches what users actually see in the feed.
        `SELECT COUNT(*)::text AS count
         FROM jobs
         WHERE jobs.is_active = true
           AND ${sqlPublishedJob("jobs")}
           AND ${sqlJobLocatedInUsa("jobs")}
           AND jobs.first_detected_at >= $1`,
        [oneHourAgo]
      ),
    ])

    const hasMore = jobsResult.rows.length > limit
    const jobs = dedupeFeedJobsBySignature(jobsResult.rows.slice(0, limit))
    const total = offset + jobs.length + (hasMore ? 1 : 0)
    const newInLastHour = Number(newInLastHourResult.rows[0]?.count ?? 0)

    if (withScores && jobs.length > 0) {
      try {
        const supabase = await createClient()
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (user) {
          const jobIds = jobs.map((j) => String(j.id))
          const byJobId = await scoreJobsForUser(user.id, jobIds)
          for (const job of jobs) {
            const existing = byJobId.get(String(job.id))
            ;(job as Record<string, unknown>).match_score =
              hasUsableMatchScore(existing ?? null) ? existing : null
          }
        }
      } catch (scoreErr) {
        console.warn("Failed to embed match scores in /api/jobs", scoreErr)
      }
    }

    const jobsWithCardView = jobs.map((j: JobWithOptionalCompany) => {
      const maybeMatchScore = (j as JobWithMatchScore).match_score ?? null
      const matchScore = hasUsableMatchScore(maybeMatchScore) ? maybeMatchScore : null
      return {
        ...j,
        match_score: matchScore,
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
    return NextResponse.json({ jobs: jobsWithCardView, total, newInLastHour, hasMore })
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
