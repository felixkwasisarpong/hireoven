import { NextRequest, NextResponse } from "next/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { computeHealthScore } from "@/lib/health/score-computer"
import type { CompanyHealthScore } from "@/types"

export const runtime = "nodejs"

const CACHE_TTL_MS = 48 * 60 * 60 * 1000

type CachedRow = {
  total_score: number
  verdict: string
  funding_score: number
  layoff_score: number
  glassdoor_score: number
  headcount_score: number
  funding_stage: string | null
  funding_amount_usd: string | null
  funding_date: string | null
  months_since_funding: number | null
  glassdoor_rating: string | null
  glassdoor_rating_12mo_ago: string | null
  glassdoor_trend: string
  headcount_current: number | null
  headcount_change_12mo_pct: string | null
  headcount_trend: string
  csuit_departures_12mo: number
  signals: CompanyHealthScore["signals"]
  events: CompanyHealthScore["events"]
  last_computed_at: string
}

function rowToScore(companyId: string, row: CachedRow): CompanyHealthScore {
  return {
    companyId,
    totalScore: row.total_score,
    verdict: row.verdict as CompanyHealthScore["verdict"],
    fundingScore: row.funding_score,
    layoffScore: row.layoff_score,
    glassdoorScore: row.glassdoor_score,
    headcountScore: row.headcount_score,
    fundingStage: row.funding_stage,
    fundingAmountUsd: row.funding_amount_usd ? Number(row.funding_amount_usd) : null,
    fundingDate: row.funding_date,
    monthsSinceFunding: row.months_since_funding,
    glassdoorRating: row.glassdoor_rating ? Number(row.glassdoor_rating) : null,
    glassdoorRating12moAgo: row.glassdoor_rating_12mo_ago ? Number(row.glassdoor_rating_12mo_ago) : null,
    glassdoorTrend: row.glassdoor_trend as CompanyHealthScore["glassdoorTrend"],
    headcountCurrent: row.headcount_current,
    headcountChange12moPct: row.headcount_change_12mo_pct ? Number(row.headcount_change_12mo_pct) : null,
    headcountTrend: row.headcount_trend as CompanyHealthScore["headcountTrend"],
    csuiteDepatures12mo: row.csuit_departures_12mo,
    signals: row.signals ?? [],
    events: row.events ?? [],
    lastComputedAt: row.last_computed_at,
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const pool = getPostgresPool()

  // Check cache
  const cached = await pool.query<CachedRow>(
    `SELECT * FROM company_health_scores WHERE company_id = $1 LIMIT 1`,
    [id]
  ).catch(() => ({ rows: [] as CachedRow[] }))

  const row = cached.rows[0]
  if (row && Date.now() - new Date(row.last_computed_at).getTime() < CACHE_TTL_MS) {
    return NextResponse.json(rowToScore(id, row))
  }

  // Compute fresh
  try {
    const score = await computeHealthScore(id)
    return NextResponse.json(score)
  } catch (err) {
    // Return stale cache if compute fails
    if (row) return NextResponse.json(rowToScore(id, row))
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Compute failed" },
      { status: 500 }
    )
  }
}
