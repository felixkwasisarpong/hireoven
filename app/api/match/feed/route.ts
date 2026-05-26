import { NextRequest, NextResponse } from "next/server"
import {
  matchesLocationFilter,
  matchesSearchQuery,
} from "@/lib/jobs/search-match"
import { dedupeFeedJobsBySignature } from "@/lib/jobs/feed-dedupe"
import { sqlJobLocatedInUsa } from "@/lib/jobs/usa-job-sql"
import { getCachedScoresForUser, scoreJobsForUser } from "@/lib/matching/batch-scorer"
import { hasUsableMatchScore } from "@/lib/jobs/match-score-display"
import { getPostgresPool } from "@/lib/postgres/server"
import { createClient } from "@/lib/supabase/server"
import { formatEmploymentLabel, formatSalaryLabel } from "@/lib/jobs/normalization/view-model"
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
  const hybrid = sp.get("hybrid") === "true"
  const onsite = sp.get("onsite") === "true"
  const minSalary = Math.max(0, parseInt(sp.get("minSalary") ?? "0", 10) || 0)
  const skills = parseList<string>(sp.get("skills"))?.map((value) => value.toLowerCase()) ?? []
  const titles = parseList<string>(sp.get("titles"))?.map((value) => value.trim()).filter(Boolean) ?? []
  const industryQuery = sp.get("industry")?.trim().toLowerCase() ?? ""
  const hideBlockers = sp.get("hideBlockers") === "true"
  const hasSalary = sp.get("hasSalary") === "true"
  const directAtsOnly = sp.get("directAtsOnly") === "true"
  const within = sp.get("within") ?? "all"
  // Best Match is a "fresh fit" view — saved jobs (which live on the
  // Applications board) are excluded from it. Any other sort or the default
  // feed surfaces saved jobs via the UNION so a job saved via the chrome
  // extension shows up immediately.
  const sortMode = sp.get("sort") ?? ""
  const isBestMatch = sortMode === "match"
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
  // Sponsorship filter policy:
  // - Explicit sponsors_h1b=true always passes.
  // - Score-only passes require >60 and are disabled for Dice URLs because
  //   Dice postings in our dataset currently lack explicit sponsorship truth.
  if (sponsorship) {
    where.push(`(
      jobs.sponsors_h1b = true
      OR (
        jobs.sponsorship_score > 60
        AND jobs.apply_url NOT ILIKE '%dice.com%'
      )
    )`)
  }

  // Freshness window applies to the base query only. The saved-jobs UNION
  // deliberately ignores it so a job the user just saved via the extension
  // appears in the feed regardless of the JD's age. The pin-to-top sort was
  // removed separately — saved jobs rank by score in Best Match.
  if (within !== "all" && WITHIN_MS[within]) {
    where.push(`jobs.first_detected_at >= ${addParam(
      new Date(Date.now() - WITHIN_MS[within]).toISOString()
    )}`)
  }
  if (titles.length) {
    const patterns = titles.map((t) => `%${t}%`)
    where.push(`(
      jobs.normalized_title ILIKE ANY(${addParam(patterns)}::text[])
      OR jobs.title ILIKE ANY(${addParam(patterns)}::text[])
    )`)
  }

  const userIdParam = addParam(user.id)
  const limitParam = addParam(fetchLimit)
  let data: (JobWithMatchScore & { is_user_saved?: boolean })[] = []

  // Best Match is fresh+fit only — no saved-jobs UNION. Saved jobs live on
  // the Applications board (and in the regular feed below). For everything
  // else, the UNION pulls in jobs the user has explicitly saved even if
  // they fall outside the within window, so a chrome-extension save shows
  // up in the main feed regardless of the JD's age.
  const sql = isBestMatch
    ? `SELECT jobs.*, to_jsonb(companies.*) AS company,
              gjs.risk_score AS ghost_risk_score,
              gjs.risk_level AS ghost_risk_level,
              gjs.repost_count AS ghost_repost_count,
              EXISTS (
                SELECT 1 FROM job_applications ja
                WHERE ja.user_id = ${userIdParam}::uuid
                  AND ja.job_id = jobs.id
                  AND ja.is_archived = false
              ) AS is_user_saved
       FROM jobs
       LEFT JOIN companies ON companies.id = jobs.company_id
       LEFT JOIN ghost_job_scores gjs ON gjs.job_id = jobs.id
       WHERE ${where.join(" AND ")}
       ORDER BY jobs.first_detected_at DESC NULLS LAST
       LIMIT ${limitParam}`
    : `WITH base AS (
         SELECT jobs.*, to_jsonb(companies.*) AS company,
                gjs.risk_score AS ghost_risk_score,
                gjs.risk_level AS ghost_risk_level,
                gjs.repost_count AS ghost_repost_count,
                EXISTS (
                  SELECT 1 FROM job_applications ja
                  WHERE ja.user_id = ${userIdParam}::uuid
                    AND ja.job_id = jobs.id
                    AND ja.is_archived = false
                ) AS is_user_saved
         FROM jobs
         LEFT JOIN companies ON companies.id = jobs.company_id
         LEFT JOIN ghost_job_scores gjs ON gjs.job_id = jobs.id
         WHERE ${where.join(" AND ")}
         ORDER BY jobs.first_detected_at DESC NULLS LAST
         LIMIT ${limitParam}
       ),
       saved AS (
         SELECT jobs.*, to_jsonb(companies.*) AS company,
                gjs.risk_score AS ghost_risk_score,
                gjs.risk_level AS ghost_risk_level,
                gjs.repost_count AS ghost_repost_count,
                true AS is_user_saved
         FROM jobs
         LEFT JOIN companies ON companies.id = jobs.company_id
         LEFT JOIN ghost_job_scores gjs ON gjs.job_id = jobs.id
         JOIN job_applications ja
           ON ja.job_id = jobs.id
          AND ja.user_id = ${userIdParam}::uuid
          AND ja.is_archived = false
         WHERE jobs.is_active = true
           AND jobs.id NOT IN (SELECT id FROM base)
       )
       SELECT * FROM base
       UNION ALL
       SELECT * FROM saved`

  try {
    const result = await pool.query<JobWithMatchScore & { is_user_saved: boolean }>(
      sql,
      params
    )
    data = result.rows
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Database query failed" },
      { status: 500 }
    )
  }

  const filteredJobs = data.filter((job) => {
    if (remote || hybrid || onsite) {
      const matchesWorkMode =
        (remote && job.is_remote) ||
        (hybrid && job.is_hybrid) ||
        (onsite && !job.is_remote && !job.is_hybrid)
      if (!matchesWorkMode) return false
    }
    if (!matchesSearch(job, q)) return false
    if (
      !matchesLocationFilter(job.location, location, {
        isRemote: job.is_remote,
      })
    ) {
      return false
    }
    if (minSalary > 0) {
      if (job.salary_max != null && job.salary_max < minSalary) return false
    }
    if (skills.length > 0) {
      const haystack = [
        ...(job.skills ?? []),
        job.title,
        job.normalized_title ?? "",
        job.description ?? "",
      ]
        .join(" ")
        .toLowerCase()
      for (const token of skills) {
        const t = token.trim()
        if (!t) continue
        if (!haystack.includes(t)) return false
      }
    }
    if (industryQuery) {
      const industry = job.company?.industry?.toLowerCase() ?? ""
      if (!industry.includes(industryQuery)) return false
    }
    if (hideBlockers && job.requires_authorization) return false
    if (hasSalary && job.salary_min == null && job.salary_max == null) return false
    if (directAtsOnly) {
      const ats = job.company?.ats_type
      if (!ats || ats === "custom") return false
    }
    return true
  })
  const jobs = dedupeFeedJobsBySignature(filteredJobs)
  let scoreMap = new Map<string, JobMatchScore>()

  // Best Match pays the full scoring cost (compute on cache miss). Every
  // other sort reads from cache only — that's the bottleneck users feel
  // when toggling between Best Match and Freshest, because each algorithm
  // version bump invalidates the cache and Best Match's next load has to
  // recompute ~120 scores in-process (6-24s). Freshest doesn't strictly
  // need fresh scores; cards with no cached score just render without a
  // match badge until the next Best Match pass back-fills the cache.
  try {
    const ids = jobs.map((job) => job.id)
    scoreMap = isBestMatch
      ? await scoreJobsForUser(user.id, ids)
      : await getCachedScoresForUser(user.id, ids)
    console.log(`[match/feed] scored ${scoreMap.size}/${jobs.length} jobs for user ${user.id} (mode: ${isBestMatch ? "compute" : "cache-only"})`)
  } catch (error) {
    console.error("Failed to score personalized feed", error)
  }

  // Sort purely by overall_score (highest first) so "Best match" means
  // exactly what it says. Freshness is the tie-breaker. Previously this
  // path blended `overall*0.75 + freshness*0.25` into a `final_rank`,
  // which allowed a fresh 85% to outrank a 95% from 3 days ago — confusing
  // when the UI badge labels the higher-% card as the best match.
  const ranked = jobs
    .map((job) => {
      const matchScore = scoreMap.get(job.id) ?? null
      const sanitizedMatchScore = hasUsableMatchScore(matchScore) ? matchScore : null
      return { ...job, match_score: sanitizedMatchScore }
    })
    // User-saved jobs bypass the minScore gate — the user has signalled intent.
    .filter((job) =>
      job.is_user_saved
        ? true
        : job.match_score
        ? job.match_score.overall_score >= minScore
        : minScore <= 0,
    )
    .sort((left, right) => {
      // Best Match is purely score-ordered. Saved jobs no longer pin to the
      // top — they're still visible (with the bookmark badge) and bypass
      // minScore via the filter above, but they're ranked alongside everything
      // else so a 99% fresh match doesn't get outranked by a 60% saved one.
      const a = left.match_score?.overall_score ?? -1
      const b = right.match_score?.overall_score ?? -1
      if (a !== b) return b - a
      return (
        new Date(right.first_detected_at).getTime() -
        new Date(left.first_detected_at).getTime()
      )
    })

  const paginated = ranked.slice(offset, offset + limit).map(job => ({
    ...job,
    match_score: hasUsableMatchScore(job.match_score ?? null) ? job.match_score : null,
    card_view: {
      title: job.title,
      location: job.location ?? null,
      salary_label: formatSalaryLabel(job.salary_min, job.salary_max, job.salary_currency) ?? null,
      employment_label: formatEmploymentLabel(job.employment_type) ?? null,
      seniority_label: null,
      preview_description: null,
      skills: job.skills ?? [],
      skill_groups: null,
      sponsorship_badge: null,
      visa_card_label: null,
      show_visa_drawer: false,
    },
  }))
  const newInLastHour = ranked.filter(
    (job) => Date.now() - new Date(job.first_detected_at).getTime() <= 3_600_000
  ).length

  return NextResponse.json({
    jobs: paginated,
    total: ranked.length,
    newInLastHour,
  })
}
