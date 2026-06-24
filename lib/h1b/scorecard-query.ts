import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"
import { h1bSponsorPath } from "@/lib/seo/company-seo"
import { scoreBucket } from "./scorecard"
import type { ScorecardPayload } from "@/types/h1b-scorecard"

interface TopState {
  state?: string
}
interface TopTitle {
  title?: string
}

interface Row {
  id: string
  name: string
  domain: string | null
  logo_url: string | null
  industry: string | null
  sponsorship_confidence: number | null
  total_applications: number | null
  total_certified: number | null
  certification_rate: string | null
  latest_fy: number | null
  certified_latest_fy: number | null
  filed_latest_fy: number | null
  top_states: TopState[] | null
  top_job_titles: TopTitle[] | null
  is_staffing_firm: boolean | null
  is_consulting_firm: boolean | null
  has_high_denial_rate: boolean | null
  rank_volume: string | null
  rank_cert_rate: string | null
  rank_in_industry: string | null
  refreshed_at: Date | string | null
}

function num(v: string | number | null): number | null {
  if (v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export async function getCompanyScorecard(
  companyId: string
): Promise<ScorecardPayload | null> {
  if (!hasPostgresEnv()) return null
  const pool = getPostgresPool()
  const { rows } = await pool.query<Row>(
    `SELECT
       c.id, c.name, c.domain, c.logo_url, c.industry,
       c.sponsorship_confidence,
       lb.total_applications, lb.total_certified, lb.certification_rate,
       lb.latest_fy, lb.certified_latest_fy, lb.filed_latest_fy,
       lb.top_states, lb.top_job_titles,
       lb.is_staffing_firm, lb.is_consulting_firm, lb.has_high_denial_rate,
       lb.rank_volume, lb.rank_cert_rate, lb.rank_in_industry,
       lb.refreshed_at
     FROM companies c
     LEFT JOIN h1b_leaderboard_mv lb ON lb.company_id = c.id
     WHERE c.id = $1 AND c.is_active = true
     LIMIT 1`,
    [companyId]
  )
  const r = rows[0]
  if (!r) return null

  // Multi-year approved-petition history from USCIS h1b_records (real FY-over-FY data,
  // unlike the FY2025-dominated LCA stats). Exclude the in-progress fiscal year so the
  // trend line isn't dragged down by a partial year. Federal FY starts Oct 1.
  const now = new Date()
  const currentFy = now.getUTCMonth() + 1 >= 10 ? now.getUTCFullYear() + 1 : now.getUTCFullYear()
  const lastCompleteFy = currentFy - 1
  const { rows: seriesRows } = await pool.query<{ year: number; approved: string | null }>(
    `SELECT year, SUM(approved)::text AS approved
     FROM h1b_records
     WHERE company_id = $1 AND year <= $2
     GROUP BY year ORDER BY year DESC LIMIT 5`,
    [companyId, lastCompleteFy]
  )
  const series = seriesRows
    .map((s) => ({ year: s.year, approved: num(s.approved) ?? 0 }))
    .reverse() // oldest → newest for the sparkline

  const score = r.sponsorship_confidence ?? 0
  const bucket = scoreBucket(score)
  const path = h1bSponsorPath(r.id, r.name)

  return {
    company: {
      id: r.id,
      name: r.name,
      domain: r.domain,
      logo_url: r.logo_url,
      industry: r.industry,
    },
    score,
    bucket,
    metrics: {
      total_filings: r.total_applications ?? 0,
      certified: r.total_certified ?? 0,
      cert_rate: num(r.certification_rate) ?? 0,
      latest_fy: r.latest_fy ?? 0,
      certified_latest_fy: r.certified_latest_fy ?? 0,
      filed_latest_fy: r.filed_latest_fy ?? 0,
      series,
      top_states: (r.top_states ?? []).map((s) => s.state).filter((s): s is string => !!s),
      top_titles: (r.top_job_titles ?? []).map((t) => t.title).filter((t): t is string => !!t),
    },
    flags: {
      is_staffing_firm: Boolean(r.is_staffing_firm),
      is_consulting_firm: Boolean(r.is_consulting_firm),
      has_high_denial_rate: Boolean(r.has_high_denial_rate),
    },
    rank: {
      overall: num(r.rank_volume),
      cert_rate: num(r.rank_cert_rate),
      in_industry: num(r.rank_in_industry),
      industry: r.industry,
    },
    refreshed_at: r.refreshed_at ? new Date(r.refreshed_at).toISOString() : new Date(0).toISOString(),
    scorecard_url: `${path}/scorecard`,
    profile_url: path,
  }
}
