import { NextRequest, NextResponse } from "next/server"
import {
  matchesLocationFilter,
  matchesSearchQuery,
} from "@/lib/jobs/search-match"
import {
  buildJobSearchTokenSql,
  escapeLikePattern,
  tokenizeJobSearchQuery,
} from "@/lib/jobs/search-sql"
import { dedupeFeedJobsBySignature } from "@/lib/jobs/feed-dedupe"
import { sqlJobLocatedInUsa } from "@/lib/jobs/usa-job-sql"
import { getCachedScoresForUser, scoreJobsForUser } from "@/lib/matching/batch-scorer"
import { hasUsableMatchScore } from "@/lib/jobs/match-score-display"
import { sqlPublishedJob } from "@/lib/jobs/publication"
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

// Every jobs column EXCEPT raw_data (a ~47 GB TOAST blob the feed never uses).
// Selecting `jobs.*` de-toasted it for every returned card; this avoids that.
const JOB_FEED_COLUMNS = [
  "id", "company_id", "title", "department", "location", "is_remote", "is_hybrid",
  "employment_type", "seniority_level", "salary_min", "salary_max", "salary_currency",
  "description", "apply_url", "external_id", "first_detected_at", "last_seen_at",
  "is_active", "sponsors_h1b", "sponsorship_score", "visa_language_detected",
  "requires_authorization", "skills", "normalized_title", "created_at", "updated_at",
  "h1b_prediction", "h1b_prediction_at", "normalization_version", "normalization_confidence",
  "normalization_completeness", "normalization_requires_review", "posted_at", "closed_at",
  "content_hash", "source_ats", "source_ats_slug", "duplicate_of_id", "is_us_or_ca_strict",
  "job_intelligence", "publication_status",
].map((c) => `jobs.${c}`).join(", ")

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

// ── "Most relevant" blend ─────────────────────────────────────────────────────
// Relevant = profile match score + search-text relevance + freshness, so a
// strong-but-slightly-older match beats a fresh weak one, while a typed query
// still pulls exact title/company hits to the top. These helpers mirror the
// client comparator in lib/hooks/useJobs.ts EXACTLY so the server's first paint
// and the client's re-sort agree (no reorder flash). Keep them in sync.
function freshnessRelevanceScore(timestamp: string | Date | null | undefined): number {
  if (!timestamp) return 0
  const minutes = Math.max(1, Math.floor((Date.now() - new Date(timestamp).getTime()) / 60_000))
  return Math.max(0, 500 - minutes)
}

function textRelevanceScore(job: JobWithMatchScore, query: string): number {
  if (!query) return 0
  const title = `${job.title ?? ""} ${job.normalized_title ?? ""}`.toLowerCase().trim()
  const company = job.company?.name?.toLowerCase() ?? ""
  const location = job.location?.toLowerCase() ?? ""
  const skills = job.skills?.join(" ").toLowerCase() ?? ""
  let score = 0
  if (title === query) score += 80
  else if (title.startsWith(query)) score += 55
  else if (title.includes(query)) score += 40
  if (company.includes(query)) score += 28
  if (skills.includes(query)) score += 22
  if (location.includes(query)) score += 12
  return score
}

// Weights: score (0–100)×4 leads, text (0–~142)×3 dominates on a query match,
// freshness (0–500)×0.5 keeps recent jobs lifted without burying strong matches.
function relevanceBlend(job: JobWithMatchScore, query: string): number {
  const score = job.match_score?.overall_score ?? 0
  return score * 4 + textRelevanceScore(job, query) * 3 + freshnessRelevanceScore(job.first_detected_at) * 0.5
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
  const isRelevant = sortMode === "relevant"
  const computeScores =
    sp.get("computeScores") === "1" || sp.get("compute_scores") === "1"
  // Match/Relevant rank by score/blend rather than fetch order, so they serve a
  // fixed, stably-ranked candidate pool and let the client paginate it locally
  // (see fetchLimit below). They may request the whole pool in one page; every
  // other sort streams in small chunks. The computeScores path (/matches
  // real-time scoring) is excluded — it keeps its small, cheap growing pool so
  // synchronous scoring stays fast.
  const needsStablePool = (isBestMatch || isRelevant) && !computeScores
  const maxLimit = needsStablePool ? 1500 : 80
  const limit = Math.min(maxLimit, parseInt(sp.get("limit") ?? "24", 10))
  const offset = Math.max(0, parseInt(sp.get("offset") ?? "0", 10))
  const minScore = Number(sp.get("minScore") ?? "0")
  const hasTextSearch = Boolean(q.trim() || location)
  const fetchMultiplier = hasTextSearch ? 3 : 2
  // The feed now paginates through the ENTIRE freshness window via "load more" /
  // infinite scroll instead of dead-ending at a small cap (the old 160/220 hid
  // everything past ~page 11).
  //
  // CANDIDATE_CEILING is a safety bound for the shared 4 GB PG box, not a product
  // cap: a single Adzuna ingest can drop tens of thousands of rows with
  // near-identical first_detected_at, and an unbounded fetch would pull the whole
  // day. 1500 covers any realistic personalized 24h window while keeping each
  // request's fetch bounded. The computeScores path (/matches real-time scoring)
  // stays small — it scores synchronously and must stay fast.
  const CANDIDATE_CEILING = computeScores ? 160 : 1500
  const candidateFloor = isBestMatch && computeScores ? 80 : 60
  // Match/Relevant rank by score/blend, NOT by fetch order, so a growing pool
  // would let an older high-score job enter only after the scroll offset has
  // passed where it ranks — it would never surface. They need a STABLE pool:
  // fetch a fixed candidate set (the freshest CANDIDATE_CEILING in the window),
  // rank it once, and serve every page as a consistent slice of that ranking —
  // so "load more" walks the complete ranked set top to bottom.
  //
  // Freshest's sort order IS its fetch order, so a cheap growing prefix is both
  // stable and complete there — no need to pull the full pool on first paint.
  const fetchLimit = needsStablePool
    ? CANDIDATE_CEILING
    : Math.min(CANDIDATE_CEILING, Math.max(limit + offset, candidateFloor) * fetchMultiplier)

  const globalScope = sp.get("global") === "1"

  const pool = getPostgresPool()
  const where: string[] = [
    "jobs.is_active = true",
    sqlPublishedJob("jobs"),
    // Skip the US/CA location gate when the caller is viewing a specific
    // company's profile and has opted into global scope.
    ...(globalScope && companyIds?.length ? [] : [sqlJobLocatedInUsa("jobs")]),
  ]
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
  if (q.trim()) {
    // Push text search into SQL before LIMIT/OFFSET. Filtering only after
    // fetching the newest candidate window makes the header search appear
    // broken for companies/titles that are not in the freshest slice.
    for (const token of tokenizeJobSearchQuery(q)) {
      const p = addParam(`%${escapeLikePattern(token)}%`)
      where.push(buildJobSearchTokenSql({ patternParam: p, token }))
    }
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
  // Explicit column list excludes raw_data — a ~47 GB TOAST blob the feed never
  // renders. `jobs.*` was de-toasting it for every card on every load.
  const sql = isBestMatch
    ? `SELECT ${JOB_FEED_COLUMNS}, to_jsonb(companies.*) AS company,
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
       ORDER BY jobs.first_detected_at DESC NULLS LAST, jobs.id DESC
       LIMIT ${limitParam}`
    : `WITH base AS (
         SELECT ${JOB_FEED_COLUMNS}, to_jsonb(companies.*) AS company,
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
         ORDER BY jobs.first_detected_at DESC NULLS LAST, jobs.id DESC
         LIMIT ${limitParam}
       ),
       saved AS (
         SELECT ${JOB_FEED_COLUMNS}, to_jsonb(companies.*) AS company,
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
           AND ${sqlPublishedJob("jobs")}
           AND jobs.id NOT IN (SELECT id FROM base)
           ${companyIds?.length ? `AND jobs.company_id::text = ANY(${addParam(companyIds)}::text[])` : ""}
           ${titles.length ? `AND (jobs.normalized_title ILIKE ANY(${addParam(titles.map((t) => `%${t}%`))}::text[]) OR jobs.title ILIKE ANY(${addParam(titles.map((t) => `%${t}%`))}::text[]))` : ""}
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

  // Keep the feed's first paint cache-only. Computing match scores on cache
  // misses can take several seconds for large batches and makes the dashboard feel hung.
  // Visible cards backfill missing scores through /api/match/score/batch after
  // the feed has rendered. Explicit callers can opt into blocking computation.
  try {
    const ids = jobs.map((job) => job.id)
    scoreMap = isBestMatch && computeScores
      ? await scoreJobsForUser(user.id, ids)
      : await getCachedScoresForUser(user.id, ids)
    console.log(`[match/feed] scored ${scoreMap.size}/${jobs.length} jobs for user ${user.id} (mode: ${isBestMatch && computeScores ? "compute" : "cache-only"})`)
  } catch (error) {
    console.error("Failed to score personalized feed", error)
  }

  // Sort purely by overall_score (highest first) so "Best match" means
  // exactly what it says. Freshness is the tie-breaker. Previously this
  // path blended `overall*0.75 + freshness*0.25` into a `final_rank`,
  // which allowed a fresh 85% to outrank a 95% from 3 days ago — confusing
  // when the UI badge labels the higher-% card as the best match.
  const relevanceQuery = q.trim().toLowerCase()
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
      // Best Match is purely score-ordered (freshness as tie-break). Saved jobs
      // no longer pin to the top — they're still visible (with the bookmark
      // badge) and bypass minScore via the filter above, but they're ranked
      // alongside everything else so a 99% fresh match doesn't get outranked by
      // a 60% saved one.
      //
      // Any OTHER sort (Freshest / Relevant / default) must NOT be score-ranked
      // here: the candidate query already returns rows in first_detected_at DESC
      // order, so falling straight through to the freshness comparator makes
      // "Freshest" a true chronological stream of every incoming job (scored
      // only for the badge). Previously this block re-ranked by score
      // unconditionally, so "Freshest" showed a thin slice of top matches
      // stretched across the whole window instead of the newest jobs.
      if (isBestMatch) {
        const a = left.match_score?.overall_score ?? -1
        const b = right.match_score?.overall_score ?? -1
        if (a !== b) return b - a
      } else if (isRelevant) {
        // Most relevant: score + text + freshness blend (see relevanceBlend).
        const a = relevanceBlend(left, relevanceQuery)
        const b = relevanceBlend(right, relevanceQuery)
        if (a !== b) return b - a
      }
      const byFreshness =
        new Date(right.first_detected_at).getTime() -
        new Date(left.first_detected_at).getTime()
      if (byFreshness !== 0) return byFreshness
      // Deterministic final tiebreaker so the ranked order is total and stable
      // across paginated requests (Adzuna inserts many near-identical timestamps).
      return right.id < left.id ? -1 : right.id > left.id ? 1 : 0
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
