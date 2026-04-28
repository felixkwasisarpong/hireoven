import { NextRequest, NextResponse } from "next/server"
import {
  matchesLocationFilter,
  matchesSearchQuery,
} from "@/lib/jobs/search-match"
import { sqlJobLocatedInUsa } from "@/lib/jobs/usa-job-sql"
import { scoreJobsForUser } from "@/lib/matching/batch-scorer"
import { getPostgresPool } from "@/lib/postgres/server"
import { createClient } from "@/lib/supabase/server"
import type {
  EmploymentType,
  JobMatchScore,
  JobWithMatchScore,
  SeniorityLevel,
} from "@/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const WITHIN_MS: Record<string, number> = {
  "1h": 3_600_000,
  "6h": 21_600_000,
  "24h": 86_400_000,
  "3d": 259_200_000,
  "7d": 604_800_000,
}

function parseList<T extends string>(value: string | null) {
  return value?.split(",").map((item) => item.trim()).filter(Boolean) as T[] | undefined
}

function matchesSearch(job: JobWithMatchScore, query: string) {
  if (
    matchesSearchQuery(
      [
        job.title,
        job.normalized_title,
        job.location,
        job.company?.name,
        job.company?.domain,
        job.skills?.join(" "),
        job.description,
      ],
      query
    )
  ) {
    return true
  }

  return matchesLocationFilter(job.location, query, {
    isRemote: job.is_remote,
  })
}

function freshnessScore(timestamp: string) {
  const hours = (Date.now() - new Date(timestamp).getTime()) / 3_600_000
  if (hours <= 1) return 100
  if (hours <= 6) return 85
  if (hours <= 24) return 65
  if (hours <= 72) return 45
  if (hours <= 168) return 25
  return 10
}

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const sp = request.nextUrl.searchParams
  const q = sp.get("q") ?? ""
  const companyIds = parseList<string>(sp.get("companies"))
  const seniority = parseList<SeniorityLevel>(sp.get("seniority"))
  const employment =
    parseList<EmploymentType>(sp.get("employment")) ??
    parseList<EmploymentType>(sp.get("employment_type"))
  const remote = sp.get("remote") === "true"
  const sponsorship = sp.get("sponsorship") === "true"
  const location = sp.get("location")?.trim() ?? ""
  const within = sp.get("within") ?? "all"
  const limit = Math.min(100, parseInt(sp.get("limit") ?? "24", 10))
  const offset = Math.max(0, parseInt(sp.get("offset") ?? "0", 10))
  const minScore = Number(sp.get("minScore") ?? "0")
  const hasTextSearch = Boolean(q.trim() || location)
  const fetchMultiplier = hasTextSearch ? 4 : 2
  const fetchLimit = Math.min(220, Math.max(limit + offset, 60) * fetchMultiplier)

  const pool = getPostgresPool()
  const where: string[] = ["jobs.is_active = true", sqlJobLocatedInUsa("jobs")]
  const params: Array<string | number | string[]> = []
  const addParam = (value: string | number | string[]) => {
    params.push(value)
    return `$${params.length}`
  }

  if (companyIds?.length) where.push(`jobs.company_id::text = ANY(${addParam(companyIds)}::text[])`)
  if (remote) where.push("jobs.is_remote = true")
  if (seniority?.length) where.push(`jobs.seniority_level = ANY(${addParam(seniority)}::text[])`)
  if (employment?.length) where.push(`jobs.employment_type = ANY(${addParam(employment)}::text[])`)
  if (sponsorship) where.push("(jobs.sponsors_h1b = true OR jobs.sponsorship_score >= 60)")
  if (within !== "all" && WITHIN_MS[within]) {
    where.push(`jobs.first_detected_at >= ${addParam(
      new Date(Date.now() - WITHIN_MS[within]).toISOString()
    )}`)
  }

  const limitParam = addParam(fetchLimit)
  let data: JobWithMatchScore[] = []
  try {
    const result = await pool.query<JobWithMatchScore>(
      `SELECT jobs.*, to_jsonb(companies.*) AS company
       FROM jobs
       LEFT JOIN companies ON companies.id = jobs.company_id
       WHERE ${where.join(" AND ")}
       ORDER BY jobs.first_detected_at DESC NULLS LAST
       LIMIT ${limitParam}`,
      params
    )
    data = result.rows
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Database query failed" },
      { status: 500 }
    )
  }

  const jobs = data.filter((job) => {
    if (!matchesSearch(job, q)) return false
    if (
      !matchesLocationFilter(job.location, location, {
        isRemote: job.is_remote,
      })
    ) {
      return false
    }
    return true
  })
  let scoreMap = new Map<string, JobMatchScore>()

  try {
    scoreMap = await scoreJobsForUser(
      user.id,
      jobs.map((job) => job.id)
    )
    console.log(`[match/feed] scored ${scoreMap.size}/${jobs.length} jobs for user ${user.id}`)
  } catch (error) {
    console.error("Failed to score personalized feed", error)
  }

  const ranked = jobs
    .map((job) => {
      const matchScore = scoreMap.get(job.id) ?? null
      const overall = matchScore?.overall_score ?? 0
      const finalRank = Number(
        ((overall * 0.65) + (freshnessScore(job.first_detected_at) * 0.35)).toFixed(2)
      )

      return {
        ...job,
        match_score: matchScore,
        final_rank: finalRank,
      }
    })
    .filter((job) => job.match_score ? job.match_score.overall_score >= minScore : minScore <= 0)
    .sort((left, right) => {
      if ((right.final_rank ?? 0) !== (left.final_rank ?? 0)) {
        return (right.final_rank ?? 0) - (left.final_rank ?? 0)
      }
      if ((right.match_score?.overall_score ?? 0) !== (left.match_score?.overall_score ?? 0)) {
        return (right.match_score?.overall_score ?? 0) - (left.match_score?.overall_score ?? 0)
      }
      return (
        new Date(right.first_detected_at).getTime() -
        new Date(left.first_detected_at).getTime()
      )
    })

  const paginated = ranked.slice(offset, offset + limit)
  const newInLastHour = ranked.filter(
    (job) => Date.now() - new Date(job.first_detected_at).getTime() <= 3_600_000
  ).length

  return NextResponse.json({
    jobs: paginated,
    total: ranked.length,
    newInLastHour,
  })
}
