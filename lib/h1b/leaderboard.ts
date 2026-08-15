import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"
import { h1bSponsorPath } from "@/lib/seo/company-seo"

// Query layer for the public H-1B Sponsor Leaderboard (Spec 01).
// Reads exclusively from the h1b_leaderboard_mv materialized view
// (scripts/migrations/add-h1b-leaderboard-mv.sql) — never a live aggregate over
// employer_lca_stats — so the memory-constrained web box stays out of heavy scans.

// Growth/YoY sorting is intentionally unsupported: the LCA dataset is effectively
// single fiscal year (FY2025), so year-over-year comparisons are not meaningful.
export type LeaderboardSort = "volume" | "cert_rate"
export type LeaderboardPeriod = "1y" | "3y" | "5y"
export type ApprovalTrend = "improving" | "stable" | "declining"

export interface LeaderboardFilters {
  sort?: LeaderboardSort
  period?: LeaderboardPeriod
  industry?: string
  state?: string // 2-letter; filters the top_states jsonb array
  size?: string
  staffing_only?: boolean
  exclude_staffing?: boolean
  layoff_risk?: "any" | "exclude_active" | "stable_only"
  cap_exempt_only?: boolean
  e_verify_only?: boolean
  min_filings?: number
  cursor?: number // rank cursor (keyset pagination)
  limit?: number // 1-50, default 25
}

export interface LeaderboardRow {
  rank: number
  company: {
    id: string
    name: string
    domain: string | null
    logo_url: string | null
    industry: string | null
    size: string | null
  }
  metrics: {
    total_filings: number
    certified: number
    denied: number
    cert_rate: number | null
    approval_trend: ApprovalTrend | null
    yoy_change_pct: number | null
    latest_fy: number | null
    prev_fy: number | null
    certified_latest_fy: number
    certified_prev_fy: number
    period_filings: number
    top_states: string[]
    top_titles: string[]
  }
  flags: {
    is_staffing_firm: boolean
    is_consulting_firm: boolean
    has_high_denial_rate: boolean
  }
  sponsorship_confidence: number | null
  profile_url: string
}

export interface LeaderboardResult {
  results: LeaderboardRow[]
  next_cursor: number | null
  total_count: number
  refreshed_at: string | null
}

const DEFAULT_LIMIT = 25
const MAX_LIMIT = 50
const DEFAULT_MIN_FILINGS = 5

interface TopState {
  state?: string
}
interface TopTitle {
  title?: string
}

interface MvRow {
  company_id: string
  company_name: string
  company_domain: string | null
  company_logo_url: string | null
  industry: string | null
  company_size: string | null
  total_applications: number
  total_certified: number
  total_denied: number
  certification_rate: string | null
  is_staffing_firm: boolean
  is_consulting_firm: boolean
  has_high_denial_rate: boolean
  approval_trend: ApprovalTrend | null
  top_states: TopState[] | null
  top_job_titles: TopTitle[] | null
  sponsorship_confidence: number | null
  latest_fy: number | null
  prev_fy: number | null
  certified_latest_fy: number
  certified_prev_fy: number
  certified_prev2_fy: number
  yoy_change_pct: string | null
  rank_volume: number
  rank_cert_rate: number
  refreshed_at: string
  sort_rank: number
}

// total_count cache: filter signature -> { count, at }. Cheap COUNT(*) over the MV,
// but cached 1h so paginating the same view doesn't recount each page.
const countCache = new Map<string, { count: number; at: number }>()
const COUNT_TTL_MS = 60 * 60 * 1000

function buildWhere(
  f: LeaderboardFilters,
  params: unknown[]
): string {
  const clauses: string[] = [
    `COALESCE(company_domain, '') NOT ILIKE '%-tenant%'`,
    `COALESCE(company_logo_url, '') NOT ILIKE '%oraclecloud.com%'`,
    `lower(company_name) NOT LIKE '%.oraclecloud.com'`,
  ]

  const minFilings = f.min_filings ?? DEFAULT_MIN_FILINGS
  params.push(minFilings)
  clauses.push(`total_applications >= $${params.length}`)

  if (f.industry) {
    params.push(f.industry)
    clauses.push(`LOWER(industry) = LOWER($${params.length})`)
  }
  if (f.size) {
    params.push(f.size)
    clauses.push(`company_size = $${params.length}`)
  }
  if (f.state) {
    params.push(JSON.stringify([{ state: f.state.toUpperCase() }]))
    clauses.push(`top_states @> $${params.length}::jsonb`)
  }
  if (f.staffing_only) {
    clauses.push(`is_staffing_firm = true`)
  }
  if (f.exclude_staffing) {
    clauses.push(`is_staffing_firm = false`)
  }
  // Layoff-risk filters (subqueries against the live layoff tables, keyed by company_id).
  if (f.layoff_risk === "exclude_active") {
    clauses.push(
      `NOT EXISTS (SELECT 1 FROM company_layoff_summary cls
         WHERE cls.company_id = h1b_leaderboard_mv.company_id
           AND cls.has_active_freeze = true AND cls.freeze_confidence = 'confirmed')`
    )
    clauses.push(
      `NOT EXISTS (SELECT 1 FROM layoff_events le
         WHERE le.company_id = h1b_leaderboard_mv.company_id
           AND le.event_date > NOW() - INTERVAL '90 days')`
    )
  } else if (f.layoff_risk === "stable_only") {
    clauses.push(
      `NOT EXISTS (SELECT 1 FROM company_layoff_summary cls
         WHERE cls.company_id = h1b_leaderboard_mv.company_id
           AND (cls.has_active_freeze = true OR cls.layoff_trend = 'accelerating'))`
    )
    clauses.push(
      `NOT EXISTS (SELECT 1 FROM layoff_events le
         WHERE le.company_id = h1b_leaderboard_mv.company_id
           AND le.event_date > NOW() - INTERVAL '12 months')`
    )
  }

  if (f.cap_exempt_only) {
    clauses.push(
      `EXISTS (SELECT 1 FROM companies c
         WHERE c.id = h1b_leaderboard_mv.company_id AND c.is_cap_exempt = true)`
    )
  }
  if (f.e_verify_only) {
    clauses.push(
      `EXISTS (SELECT 1 FROM companies c
         WHERE c.id = h1b_leaderboard_mv.company_id AND c.is_e_verify = true)`
    )
  }

  return clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""
}

function periodFilings(row: MvRow, period: LeaderboardPeriod | undefined): number {
  switch (period) {
    case "1y":
      return row.certified_latest_fy
    case "3y":
      return row.certified_latest_fy + row.certified_prev_fy + row.certified_prev2_fy
    default:
      return row.total_certified
  }
}

function mapRow(row: MvRow, period: LeaderboardPeriod | undefined): LeaderboardRow {
  return {
    rank: Number(row.sort_rank),
    company: {
      id: row.company_id,
      name: row.company_name,
      domain: row.company_domain,
      logo_url: row.company_logo_url,
      industry: row.industry,
      size: row.company_size,
    },
    metrics: {
      total_filings: row.total_applications,
      certified: row.total_certified,
      denied: row.total_denied,
      cert_rate: row.certification_rate == null ? null : Number(row.certification_rate),
      approval_trend: row.approval_trend,
      yoy_change_pct: row.yoy_change_pct == null ? null : Number(row.yoy_change_pct),
      latest_fy: row.latest_fy,
      prev_fy: row.prev_fy,
      certified_latest_fy: row.certified_latest_fy,
      certified_prev_fy: row.certified_prev_fy,
      period_filings: periodFilings(row, period),
      top_states: (row.top_states ?? []).map((s) => s.state).filter((s): s is string => !!s),
      top_titles: (row.top_job_titles ?? []).map((t) => t.title).filter((t): t is string => !!t),
    },
    flags: {
      is_staffing_firm: row.is_staffing_firm,
      is_consulting_firm: row.is_consulting_firm,
      has_high_denial_rate: row.has_high_denial_rate,
    },
    sponsorship_confidence: row.sponsorship_confidence,
    profile_url: h1bSponsorPath(row.company_id, row.company_name),
  }
}

const SELECT_COLS = `
  company_id, company_name, company_domain, company_logo_url, industry, company_size,
  total_applications, total_certified, total_denied, certification_rate,
  is_staffing_firm, is_consulting_firm, has_high_denial_rate, approval_trend,
  top_states, top_job_titles, sponsorship_confidence,
  latest_fy, prev_fy, certified_latest_fy, certified_prev_fy, certified_prev2_fy,
  yoy_change_pct, rank_volume, rank_cert_rate, refreshed_at
`

const EMPTY_RESULT: LeaderboardResult = {
  results: [],
  next_cursor: null,
  total_count: 0,
  refreshed_at: null,
}

export async function getH1bLeaderboard(
  filters: LeaderboardFilters
): Promise<LeaderboardResult> {
  if (!hasPostgresEnv()) return EMPTY_RESULT // build-time / no DB: render empty
  const pool = getPostgresPool()
  const limit = Math.min(Math.max(filters.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)
  const cursor = Math.max(filters.cursor ?? 0, 0)
  const sort: LeaderboardSort = filters.sort === "cert_rate" ? "cert_rate" : "volume"

  const params: unknown[] = []
  const where = buildWhere(filters, params)

  const rankCol = sort === "cert_rate" ? "rank_cert_rate" : "rank_volume"
  params.push(cursor)
  const cursorIdx = params.length
  params.push(limit)
  const limitIdx = params.length
  const sql = `
    SELECT ${SELECT_COLS}, ${rankCol} AS sort_rank
    FROM h1b_leaderboard_mv
    ${where}${where ? " AND" : "WHERE"} ${rankCol} > $${cursorIdx}
    ORDER BY ${rankCol} ASC LIMIT $${limitIdx}
  `

  const { rows } = await pool.query<MvRow>(sql, params)
  const results = rows.map((r) => mapRow(r, filters.period))
  const next_cursor =
    results.length === limit ? results[results.length - 1].rank : null
  const refreshed_at = rows[0]?.refreshed_at ?? null

  // total_count (filter-scoped, cached). Does not include the keyset cursor clause.
  const countParams: unknown[] = []
  const countWhere = buildWhere(filters, countParams)
  const cacheKey = `${countWhere}|${JSON.stringify(countParams)}`
  const cached = countCache.get(cacheKey)
  let total_count: number
  if (cached && Date.now() - cached.at < COUNT_TTL_MS) {
    total_count = cached.count
  } else {
    const { rows: cRows } = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM h1b_leaderboard_mv ${countWhere}`,
      countParams
    )
    total_count = Number(cRows[0]?.n ?? 0)
    countCache.set(cacheKey, { count: total_count, at: Date.now() })
  }

  return { results, next_cursor, total_count, refreshed_at }
}

export function industrySlug(industry: string): string {
  return industry
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

// Distinct industries present in the leaderboard, ordered by company count.
// Used to populate the filter dropdown and pre-render by-industry pages.
export async function getLeaderboardIndustries(): Promise<string[]> {
  if (!hasPostgresEnv()) return []
  const { rows } = await getPostgresPool().query<{ industry: string }>(
    `SELECT industry FROM h1b_leaderboard_mv
     WHERE industry IS NOT NULL
       AND COALESCE(company_domain, '') NOT ILIKE '%-tenant%'
       AND COALESCE(company_logo_url, '') NOT ILIKE '%oraclecloud.com%'
       AND lower(company_name) NOT LIKE '%.oraclecloud.com'
     GROUP BY industry ORDER BY COUNT(*) DESC`
  )
  return rows.map((r) => r.industry)
}

// Resolve a URL slug back to the canonical industry string (slug is lossy).
export async function industryFromSlug(slug: string): Promise<string | null> {
  const industries = await getLeaderboardIndustries()
  return industries.find((i) => industrySlug(i) === slug) ?? null
}

export interface CompanyH1bRank {
  rank_volume: number | null
  rank_cert_rate: number | null
  rank_in_industry: number | null
  industry: string | null
}

export async function getCompanyH1bRank(
  companyId: string
): Promise<CompanyH1bRank | null> {
  if (!hasPostgresEnv()) return null
  const pool = getPostgresPool()
  // ROW_NUMBER()/bigint columns come back as strings from node-postgres; coerce.
  const { rows } = await pool.query<{
    rank_volume: string | null
    rank_cert_rate: string | null
    rank_in_industry: string | null
    industry: string | null
  }>(
    `SELECT rank_volume, rank_cert_rate, rank_in_industry, industry
     FROM h1b_leaderboard_mv WHERE company_id = $1`,
    [companyId]
  )
  const row = rows[0]
  if (!row) return null
  return {
    rank_volume: row.rank_volume == null ? null : Number(row.rank_volume),
    rank_cert_rate: row.rank_cert_rate == null ? null : Number(row.rank_cert_rate),
    rank_in_industry: row.rank_in_industry == null ? null : Number(row.rank_in_industry),
    industry: row.industry,
  }
}
