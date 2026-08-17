/**
 * §7 Green Card Follow-Through — does this employer actually finish what it starts?
 *
 * 'Certified - Expired' means DOL certified the labor market test and the employer never
 * converted it into an I-140 inside the 180-day validity window. "Do you sponsor green cards?"
 * gets a yes from almost everyone; this is the number that answers it with filings.
 *
 * ⚠ THE TRAP: RIGHT-CENSORING. A certification cannot be marked expired until its 180-day window
 * has actually lapsed, so recent certifications are structurally incapable of being expired. A
 * naive expired/(certified+expired) therefore *rewards employers who simply filed recently*, and
 * the whole-corpus rate it produces is meaningless — measured across FY2026 Q3 it reads 15.7%,
 * versus the ~38.8% quoted for a matured FY2025 cohort. Same data, different maturity.
 *
 * So every rate here is computed ONLY over certifications whose decision_date is at least 180
 * days old. That is the cohort where "did they follow through" is a question the data can answer.
 */

import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"

/** PERM certification validity: 180 days to file the I-140. */
export const CERT_VALIDITY_DAYS = 180

/** Below this many matured certifications, a rate is noise — we report it as unknown. */
export const MIN_MATURE_SAMPLE = 5

export interface FollowThroughInput {
  /** Certifications at least CERT_VALIDITY_DAYS old that were NOT expired. */
  maturedCertified: number
  /** Certifications at least CERT_VALIDITY_DAYS old that lapsed unused. */
  maturedExpired: number
}

export interface FollowThroughResult {
  /** Share of matured certifications converted before expiry, 0-1. Null when the sample is thin. */
  rate: number | null
  maturedTotal: number
  maturedExpired: number
  confidence: "high" | "medium" | "low" | "unknown"
}

/**
 * Follow-through over the matured cohort only. Pure — the censoring decision happens in the
 * query that supplies these counts, and this asserts the sample is big enough to speak.
 */
export function computeFollowThrough(input: FollowThroughInput): FollowThroughResult {
  const certified = Math.max(0, Math.trunc(input.maturedCertified))
  const expired = Math.max(0, Math.trunc(input.maturedExpired))
  const total = certified + expired

  if (total < MIN_MATURE_SAMPLE) {
    return { rate: null, maturedTotal: total, maturedExpired: expired, confidence: "unknown" }
  }

  const rate = certified / total
  const confidence = total >= 50 ? "high" : total >= 15 ? "medium" : "low"
  return { rate, maturedTotal: total, maturedExpired: expired, confidence }
}

export interface EmployerGreenCardProfile extends FollowThroughResult {
  employerNormalized: string
  employerName: string | null
  /** All PERM filings on record, any status or age. */
  totalFilings: number
  certified: number
  expired: number
  denied: number
  withdrawn: number
  /** Median DECISION_DATE - RECEIVED_DATE in days, across decided filings. */
  medianDecisionDays: number | null
  /** Share of filings where the sponsored worker already worked there. */
  incumbentShare: number | null
  lastFilingAt: string | null
}

/** Green-card posture for one employer. */
export async function getEmployerGreenCardProfile(input: {
  employerNormalized: string
}): Promise<EmployerGreenCardProfile | null> {
  if (!hasPostgresEnv()) return null
  const norm = input.employerNormalized?.trim()
  if (!norm) return null

  try {
    const { rows } = await getPostgresPool().query<{
      employer_name: string | null
      total: string
      certified: string
      expired: string
      denied: string
      withdrawn: string
      matured_certified: string
      matured_expired: string
      median_days: string | null
      incumbent: string
      incumbent_known: string
      last_filing: string | null
    }>(
      `SELECT min(employer_name) AS employer_name,
              count(*)                                                          AS total,
              count(*) FILTER (WHERE case_status = 'Certified')                 AS certified,
              count(*) FILTER (WHERE case_status = 'Certified - Expired')       AS expired,
              count(*) FILTER (WHERE case_status = 'Denied')                    AS denied,
              count(*) FILTER (WHERE case_status = 'Withdrawn')                 AS withdrawn,
              -- Matured cohort only: old enough that expiry was possible.
              count(*) FILTER (
                WHERE case_status = 'Certified'
                  AND decision_date <= CURRENT_DATE - ($2::int)
              )                                                                 AS matured_certified,
              count(*) FILTER (
                WHERE case_status = 'Certified - Expired'
                  AND decision_date <= CURRENT_DATE - ($2::int)
              )                                                                 AS matured_expired,
              round(percentile_cont(0.5) WITHIN GROUP (
                ORDER BY (decision_date - received_date)
              ) FILTER (WHERE received_date IS NOT NULL
                         AND decision_date IS NOT NULL
                         AND decision_date >= received_date))::text             AS median_days,
              count(*) FILTER (WHERE fw_currently_working)                      AS incumbent,
              count(*) FILTER (WHERE fw_currently_working IS NOT NULL)          AS incumbent_known,
              max(decision_date)::text                                          AS last_filing
         FROM perm_records
        WHERE employer_name_normalized = $1`,
      [norm, CERT_VALIDITY_DAYS]
    )

    const r = rows[0]
    if (!r) return null
    const total = Number(r.total)
    if (!total) return null

    const ft = computeFollowThrough({
      maturedCertified: Number(r.matured_certified),
      maturedExpired: Number(r.matured_expired),
    })
    const incumbentKnown = Number(r.incumbent_known)

    return {
      ...ft,
      employerNormalized: norm,
      employerName: r.employer_name,
      totalFilings: total,
      certified: Number(r.certified),
      expired: Number(r.expired),
      denied: Number(r.denied),
      withdrawn: Number(r.withdrawn),
      medianDecisionDays: r.median_days === null ? null : Number(r.median_days),
      incumbentShare: incumbentKnown > 0 ? Number(r.incumbent) / incumbentKnown : null,
      lastFilingAt: r.last_filing,
    }
  } catch {
    return null
  }
}

/**
 * Corpus-wide follow-through over the matured cohort — the honest denominator to compare an
 * employer against. Cache this; it moves once a quarter.
 */
export async function getMarketFollowThrough(): Promise<FollowThroughResult | null> {
  if (!hasPostgresEnv()) return null
  try {
    const { rows } = await getPostgresPool().query<{ certified: string; expired: string }>(
      `SELECT count(*) FILTER (WHERE case_status = 'Certified')           AS certified,
              count(*) FILTER (WHERE case_status = 'Certified - Expired') AS expired
         FROM perm_records
        WHERE decision_date <= CURRENT_DATE - ($1::int)
          AND case_status IN ('Certified', 'Certified - Expired')`,
      [CERT_VALIDITY_DAYS]
    )
    const r = rows[0]
    if (!r) return null
    return computeFollowThrough({
      maturedCertified: Number(r.certified),
      maturedExpired: Number(r.expired),
    })
  } catch {
    return null
  }
}
