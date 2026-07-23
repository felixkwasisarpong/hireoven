import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"
import { computeStayScore, type StayScoreResult } from "./stay-score"

export interface CapExemptStats {
  employers: number
  openRoles: number
}

/**
 * Cheap aggregates for the /stay hero — both read denormalized columns on the
 * (small) companies table, so there is NO jobs-table scan. `job_count` is the
 * maintained per-company open-role count, summed only over cap-exempt employers.
 */
export async function getCapExemptStats(): Promise<CapExemptStats> {
  if (!hasPostgresEnv()) return { employers: 0, openRoles: 0 }
  try {
    const pool = getPostgresPool()
    const { rows } = await pool.query<{ employers: string; roles: string }>(
      `SELECT COUNT(*)::text AS employers,
              COALESCE(SUM(GREATEST(job_count, 0)), 0)::bigint::text AS roles
         FROM companies
        WHERE is_cap_exempt = true AND is_active = true`
    )
    return {
      employers: Number(rows[0]?.employers ?? 0),
      openRoles: Number(rows[0]?.roles ?? 0),
    }
  } catch {
    return { employers: 0, openRoles: 0 }
  }
}

export interface SkipListEmployer {
  id: string
  name: string
  domain: string | null
  logo_url: string | null
  industry: string | null
  cap_exempt_reason: string | null
  open_roles: number
}

/** A bounded slice of cap-exempt employers with open roles — the "Lottery Skip List". */
export async function getSkipListEmployers(limit = 12): Promise<SkipListEmployer[]> {
  if (!hasPostgresEnv()) return []
  try {
    const pool = getPostgresPool()
    const { rows } = await pool.query<SkipListEmployer & { open_roles: number }>(
      `SELECT id, name, domain, logo_url, industry, cap_exempt_reason,
              GREATEST(COALESCE(job_count, 0), 0) AS open_roles
         FROM companies
        WHERE is_cap_exempt = true AND is_active = true AND COALESCE(job_count, 0) > 0
        ORDER BY job_count DESC NULLS LAST
        LIMIT $1`,
      [Math.min(Math.max(1, limit), 60)]
    )
    return rows
  } catch {
    return []
  }
}

export interface EmployerStayLookup {
  found: boolean
  name: string
  domain: string | null
  capExempt: boolean
  capExemptReason: string | null
  result: StayScoreResult
}

/**
 * Resolve an employer by name and compute a real Stay Score from Hireoven's
 * sponsorship graph. Salary + STEM come from the visitor's demo inputs so the
 * lottery component reflects "someone like you" at this employer.
 */
export async function lookupEmployerForStay(input: {
  query: string
  salary: number
  isStem: boolean
}): Promise<EmployerStayLookup> {
  const query = input.query.trim()
  const fallback = (): EmployerStayLookup => ({
    found: false,
    name: query || "This employer",
    domain: null,
    capExempt: false,
    capExemptReason: null,
    result: computeStayScore({ salary: input.salary, isStem: input.isStem }),
  })

  if (!query || !hasPostgresEnv()) return fallback()

  try {
    const pool = getPostgresPool()
    const { rows } = await pool.query<{
      name: string
      domain: string | null
      is_cap_exempt: boolean | null
      cap_exempt_reason: string | null
      sponsors_h1b: boolean | null
      sponsorship_confidence: number | null
      h1b_sponsor_count_1yr: number | null
      h1b_sponsor_count_3yr: number | null
    }>(
      `SELECT name, domain, is_cap_exempt, cap_exempt_reason, sponsors_h1b,
              sponsorship_confidence, h1b_sponsor_count_1yr, h1b_sponsor_count_3yr
         FROM companies
        WHERE is_active = true
          AND (name ILIKE $1 OR name ILIKE $2)
        ORDER BY (lower(name) = lower($3)) DESC,
                 COALESCE(h1b_sponsor_count_1yr, 0) DESC,
                 COALESCE(job_count, 0) DESC
        LIMIT 1`,
      [query, `${query}%`, query]
    )
    const row = rows[0]
    if (!row) return fallback()

    const result = computeStayScore({
      capExempt: row.is_cap_exempt,
      sponsorsH1b: row.sponsors_h1b,
      sponsorshipScore: row.sponsorship_confidence,
      recentLcaCount: row.h1b_sponsor_count_1yr,
      priorLcaCount: row.h1b_sponsor_count_3yr,
      salary: input.salary,
      isStem: input.isStem,
    })

    return {
      found: true,
      name: row.name,
      domain: row.domain,
      capExempt: Boolean(row.is_cap_exempt),
      capExemptReason: row.cap_exempt_reason,
      result,
    }
  } catch {
    return fallback()
  }
}
