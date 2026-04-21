import { NextRequest, NextResponse } from "next/server"
import {
  matchesLocationFilter,
  matchesSearchQuery,
} from "@/lib/jobs/search-match"
import { getScoringContextForUser, scoreJobsForUser } from "@/lib/matching/batch-scorer"
import { createAdminClient } from "@/lib/supabase/admin"
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

  const context = await getScoringContextForUser(user.id)
  if (!context) {
    return NextResponse.json({ jobs: [], total: 0, newInLastHour: 0 })
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
  const fetchLimit = Math.min(300, Math.max(limit + offset, 60) * 4)

  const admin = createAdminClient()
  let query = admin
    .from("jobs")
    .select("*, company:companies(*)")
    .eq("is_active", true)
    .order("first_detected_at", { ascending: false })
    .limit(fetchLimit)

  if (companyIds?.length) query = query.in("company_id", companyIds)
  if (remote) query = query.eq("is_remote", true)
  if (seniority?.length) query = query.in("seniority_level", seniority)
  if (employment?.length) query = query.in("employment_type", employment)
  if (sponsorship) query = query.or("sponsors_h1b.eq.true,sponsorship_score.gte.60")
  if (within !== "all" && WITHIN_MS[within]) {
    query = query.gte(
      "first_detected_at",
      new Date(Date.now() - WITHIN_MS[within]).toISOString()
    )
  }

  const { data, error } = await (query as any)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const jobs = ((data ?? []) as JobWithMatchScore[]).filter((job) => {
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
  } catch (error) {
    console.error("Failed to score personalized feed", error)
  }

  const ranked = jobs
    .map((job) => {
      const matchScore = scoreMap.get(job.id) ?? null
      const overall = matchScore?.overall_score ?? 50
      const finalRank = Number(
        ((overall * 0.65) + (freshnessScore(job.first_detected_at) * 0.35)).toFixed(2)
      )

      return {
        ...job,
        match_score: matchScore,
        final_rank: finalRank,
      }
    })
    .filter((job) => (job.match_score?.overall_score ?? 50) >= minScore)
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
