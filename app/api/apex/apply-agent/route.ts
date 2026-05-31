/**
 * GET /api/scout/apply-agent?minMatchScore=80&count=5&sponsorship=true&workMode=remote&q=java+backend&strictQuery=true&strictScoreOnly=true&freshnessHours=24
 *
 * Selects jobs from the live feed pool (recently added, active jobs) that match
 * the user's criteria. `q` is a free-text query matched against title + description
 * so arbitrary natural language conditions ("healthcare", "fintech NYC", "Python AWS")
 * all work without any special parsing.
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

function parseClampedInt(
  raw: string | null,
  options: { min: number; max: number; fallback: number }
): number {
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return options.fallback
  const rounded = Math.trunc(parsed)
  if (rounded < options.min) return options.min
  if (rounded > options.max) return options.max
  return rounded
}

// Strip the bulk-apply framing and return the meaningful condition remainder.
// "apply to 3 jobs with java skill in it" → "java skill"
// "apply to 5 remote healthcare jobs" → "healthcare"
// "apply for 2 frontend roles at fintech companies" → "frontend fintech companies"
function extractSearchTerms(raw: string): string {
  return raw
    .replace(/\b(apply\s+(to|for)|queue|batch|bulk|prepare)\b/gi, "")
    .replace(/\b(top|best|strongest|highest|matching|scored?)\b/gi, "")
    .replace(/\b\d+\b/g, "")
    .replace(/\b(jobs?|roles?|positions?|openings?|applications?|applying)\b/gi, "")
    .replace(/\b(remote|onsite|hybrid)\b/gi, "")
    .replace(/\b(h-?1b|visa|sponsor(ship)?)\b/gi, "")
    .replace(/\b(with|in|at|for|and|the|that|has|have|a|an|it)\b/gi, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = request.nextUrl
  const minMatchScore      = parseClampedInt(searchParams.get("minMatchScore"), { min: 0, max: 100, fallback: 0 })
  const count              = parseClampedInt(searchParams.get("count"), { min: 1, max: 20, fallback: 5 })
  const requireSponsorship = searchParams.get("sponsorship") === "true"
  const workMode           = searchParams.get("workMode") ?? null
  const normalizedWorkMode = workMode?.toLowerCase().replace(/_/g, "-") ?? null
  const freshnessHours     = parseClampedInt(searchParams.get("freshnessHours"), { min: 1, max: 168, fallback: 24 })
  const rawQuery           = (searchParams.get("q") ?? "").trim()
  const strictQuery        = searchParams.get("strictQuery") === "true"
  const strictScoreOnly    = searchParams.get("strictScoreOnly") === "true"

  const pool = getPostgresPool()

  const conditions: string[] = [
    "j.is_active = true",
    "j.apply_url IS NOT NULL",
    // Fresh-posting guard: by default only return roles discovered in the
    // last 24h so "top matched" prioritizes live opportunities.
    "j.first_detected_at >= NOW() - ($2::int * INTERVAL '1 hour')",
    // Exclude jobs already in the user's application tracker (including saved/watchlist)
    `NOT EXISTS (
       SELECT 1 FROM job_applications ja
       WHERE ja.job_id = j.id
         AND ja.user_id = $1
         AND ja.is_archived = false
     )`,
  ]
  const params: unknown[] = [user.id, freshnessHours]

  // minMatchScore normally keeps null-score jobs in the pool so the queue still
  // progresses while match scoring catches up. strictScoreOnly excludes nulls.
  if (minMatchScore > 0) {
    params.push(minMatchScore)
    const scoreParam = `$${params.length}`
    if (strictScoreOnly) {
      conditions.push(`(jms.overall_score IS NOT NULL AND jms.overall_score >= ${scoreParam})`)
    } else {
      conditions.push(`(jms.overall_score >= ${scoreParam} OR jms.overall_score IS NULL)`)
    }
  }

  // Free-text search: match any meaningful word from the user's query against
  // title and description so arbitrary conditions ("java", "healthcare NYC",
  // "Python AWS", "entry level fintech") all work without special parsing.
  const searchTerms = rawQuery ? extractSearchTerms(rawQuery) : ""
  const searchWords = Array.from(
    new Set(searchTerms.split(/\s+/).filter((w) => w.length >= 3))
  ).slice(0, 8)
  if (searchWords.length > 0) {
    const wordConditions = searchWords.map((word) => {
      params.push(`%${word}%`)
      const p = `$${params.length}`
      return `(j.title ILIKE ${p} OR j.description ILIKE ${p})`
    })
    conditions.push(`(${wordConditions.join(strictQuery ? " AND " : " OR ")})`)
  }

  if (requireSponsorship) {
    conditions.push("c.sponsors_h1b = true")
  }

  if (normalizedWorkMode === "remote") {
    conditions.push("j.is_remote = true")
  } else if (normalizedWorkMode === "hybrid") {
    conditions.push("j.is_hybrid = true")
  } else if (normalizedWorkMode === "onsite" || normalizedWorkMode === "on-site") {
    conditions.push("COALESCE(j.is_remote, false) = false")
    conditions.push("COALESCE(j.is_hybrid, false) = false")
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
    // Never dead-end bulk workflows on selector failures.
    return NextResponse.json({ jobs: [] })
  }
}
