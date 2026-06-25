import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"
import { wageLevelNumber } from "./soc-roles"

export const MIN_N_FOR_DISPLAY = 5
const SENTINEL = "00000000-0000-0000-0000-000000000000"

// Annualize the mixed-unit prevailing_wage. Single source of truth for the band/units.
const ANNUAL = `CASE lower(trim(prevailing_wage_unit))
  WHEN 'hour' THEN prevailing_wage*2080
  WHEN 'week' THEN prevailing_wage*52
  WHEN 'bi-weekly' THEN prevailing_wage*26
  WHEN 'month' THEN prevailing_wage*12
  ELSE prevailing_wage END`

function levelRoman(level: number | null | undefined): string | null {
  return level == null ? null : ["", "I", "II", "III", "IV"][level] ?? null
}

export interface WageAggregate {
  n: number
  p25: number
  p50: number
  p75: number
  min: number
  max: number
  fy_range: { min: number; max: number }
}

export interface WageRollup {
  company_id: string | null
  soc_group: string | null
  state: string | null
  wage_level: number | null
  aggregate: WageAggregate | null // null if n < MIN_N_FOR_DISPLAY
  insufficient_data: boolean
}

interface SliceFilters {
  companyId?: string
  socGroup: string
  state?: string
  wageLevel?: number
  requireCompany?: boolean // company-scoped pages: exclude the sentinel (unlinked) rows
}

interface AggRow {
  n: string
  p50: string | null
  p25: string | null
  p75: string | null
  mn: string | null
  mx: string | null
  min_fy: number | null
  max_fy: number | null
}

function buildWhere(f: SliceFilters, params: unknown[]): string {
  const clauses = [
    "case_status LIKE 'Certified%'",
    "prevailing_wage > 0",
    "soc_code IS NOT NULL",
    "fiscal_year >= EXTRACT(YEAR FROM NOW())::int - 4",
  ]
  params.push(`${f.socGroup}%`)
  clauses.push(`soc_code LIKE $${params.length}`) // prefix → uses the soc_code index
  if (f.companyId) {
    params.push(f.companyId)
    clauses.push(`company_id = $${params.length}`)
  } else if (f.requireCompany) {
    clauses.push("company_id IS NOT NULL")
  }
  if (f.state) {
    params.push(f.state.toUpperCase())
    clauses.push(`worksite_state_abbr = $${params.length}`)
  }
  const roman = levelRoman(f.wageLevel)
  if (roman) {
    params.push(roman)
    clauses.push(`wage_level = $${params.length}`)
  }
  return clauses.join(" AND ")
}

async function wageSlice(f: SliceFilters): Promise<WageRollup> {
  const base: WageRollup = {
    company_id: f.companyId ?? null,
    soc_group: f.socGroup,
    state: f.state ?? null,
    wage_level: f.wageLevel ?? null,
    aggregate: null,
    insufficient_data: true,
  }
  if (!hasPostgresEnv()) return base
  const params: unknown[] = []
  const where = buildWhere(f, params)
  const { rows } = await getPostgresPool().query<AggRow>(
    `SELECT COUNT(*)::text n,
       ROUND(PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY aw))::text p50,
       ROUND(PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY aw))::text p25,
       ROUND(PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY aw))::text p75,
       ROUND(MIN(aw))::text mn, ROUND(MAX(aw))::text mx, MIN(fiscal_year) min_fy, MAX(fiscal_year) max_fy
     FROM (SELECT fiscal_year, ${ANNUAL} AS aw FROM lca_records WHERE ${where}) t
     WHERE aw BETWEEN 15000 AND 1000000`,
    params
  )
  const r = rows[0]
  const n = Number(r?.n ?? 0)
  if (n < MIN_N_FOR_DISPLAY || !r?.p50) return base
  return {
    ...base,
    insufficient_data: false,
    aggregate: {
      n,
      p25: Number(r.p25),
      p50: Number(r.p50),
      p75: Number(r.p75),
      min: Number(r.mn),
      max: Number(r.mx),
      fy_range: { min: r.min_fy ?? 0, max: r.max_fy ?? 0 },
    },
  }
}

export function getWageForCompanyRole(
  companyId: string,
  socGroup: string,
  state?: string,
  wageLevel?: number
): Promise<WageRollup> {
  return wageSlice({ companyId, socGroup, state, wageLevel })
}

export function getWageForRole(
  socGroup: string,
  state?: string,
  wageLevel?: number
): Promise<WageRollup> {
  return wageSlice({ socGroup, state, wageLevel }) // all certified filings, linked or not
}

export interface TopCompanyWage {
  company: { id: string; name: string }
  n: number
  p50: number
  p25: number
  p75: number
}

export async function getTopPayingCompaniesForRole(
  socGroup: string,
  state?: string,
  limit = 25
): Promise<TopCompanyWage[]> {
  if (!hasPostgresEnv()) return []
  const params: unknown[] = [`${socGroup}%`]
  let where = `case_status LIKE 'Certified%' AND prevailing_wage > 0 AND company_id IS NOT NULL
    AND soc_code LIKE $1 AND fiscal_year >= EXTRACT(YEAR FROM NOW())::int - 4`
  if (state) {
    params.push(state.toUpperCase())
    where += ` AND worksite_state_abbr = $${params.length}`
  }
  params.push(MIN_N_FOR_DISPLAY, limit)
  const { rows } = await getPostgresPool().query<{
    id: string; name: string; n: string; p50: string; p25: string; p75: string
  }>(
    `SELECT c.id, c.name, t.n::text, t.p50::text, t.p25::text, t.p75::text
     FROM (
       SELECT company_id, COUNT(*) n,
         ROUND(PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY aw)) p50,
         ROUND(PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY aw)) p25,
         ROUND(PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY aw)) p75
       FROM (SELECT company_id, ${ANNUAL} AS aw FROM lca_records WHERE ${where}) s
       WHERE aw BETWEEN 15000 AND 1000000
       GROUP BY company_id
       HAVING COUNT(*) >= $${params.length - 1}
       ORDER BY p50 DESC
       LIMIT $${params.length}
     ) t
     JOIN companies c ON c.id = t.company_id`,
    params
  )
  return rows.map((r) => ({
    company: { id: r.id, name: r.name },
    n: Number(r.n),
    p50: Number(r.p50),
    p25: Number(r.p25),
    p75: Number(r.p75),
  }))
}

export async function getRoleStateBreakdown(
  socGroup: string
): Promise<Array<{ state: string; n: number; p50: number }>> {
  if (!hasPostgresEnv()) return []
  const { rows } = await getPostgresPool().query<{ st: string; n: string; p50: string }>(
    `SELECT st, COUNT(*)::text n, ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY aw))::text p50
     FROM (SELECT worksite_state_abbr st, ${ANNUAL} AS aw
           FROM lca_records
           WHERE case_status LIKE 'Certified%' AND prevailing_wage > 0
             AND soc_code LIKE $1 AND worksite_state_abbr IS NOT NULL
             AND fiscal_year >= EXTRACT(YEAR FROM NOW())::int - 4) s
     WHERE aw BETWEEN 15000 AND 1000000
     GROUP BY st HAVING COUNT(*) >= ${MIN_N_FOR_DISPLAY}
     ORDER BY COUNT(*) DESC LIMIT 25`,
    [`${socGroup}%`]
  )
  return rows.map((r) => ({ state: r.st, n: Number(r.n), p50: Number(r.p50) }))
}

export interface CompanyWageBreakdown {
  roles: Array<{ soc_group: string; n: number; p50: number }>
  states: Array<{ state: string; n: number; p50: number }>
}

export async function getCompanyWageBreakdown(companyId: string): Promise<CompanyWageBreakdown> {
  if (!hasPostgresEnv()) return { roles: [], states: [] }
  const pool = getPostgresPool()
  const filtered = `(SELECT LEFT(soc_code,5) sg, worksite_state_abbr st, ${ANNUAL} AS aw, fiscal_year
                     FROM lca_records
                     WHERE company_id = $1 AND case_status LIKE 'Certified%' AND prevailing_wage > 0
                       AND fiscal_year >= EXTRACT(YEAR FROM NOW())::int - 4) s`
  const [roles, states] = await Promise.all([
    pool.query<{ sg: string; n: string; p50: string }>(
      `SELECT sg, COUNT(*)::text n, ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY aw))::text p50
       FROM ${filtered} WHERE aw BETWEEN 15000 AND 1000000 AND sg IS NOT NULL
       GROUP BY sg HAVING COUNT(*) >= ${MIN_N_FOR_DISPLAY} ORDER BY COUNT(*) DESC LIMIT 12`,
      [companyId]
    ),
    pool.query<{ st: string; n: string; p50: string }>(
      `SELECT st, COUNT(*)::text n, ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY aw))::text p50
       FROM ${filtered} WHERE aw BETWEEN 15000 AND 1000000 AND st IS NOT NULL
       GROUP BY st HAVING COUNT(*) >= ${MIN_N_FOR_DISPLAY} ORDER BY COUNT(*) DESC LIMIT 12`,
      [companyId]
    ),
  ])
  return {
    roles: roles.rows.map((r) => ({ soc_group: r.sg, n: Number(r.n), p50: Number(r.p50) })),
    states: states.rows.map((r) => ({ state: r.st, n: Number(r.n), p50: Number(r.p50) })),
  }
}
