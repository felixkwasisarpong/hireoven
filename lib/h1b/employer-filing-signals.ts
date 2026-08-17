/**
 * Smaller signals that fall out of the PERM/PWD corpus we already ingest.
 *
 *   §9  SOC override      — DOL rejected the occupation classification the employer requested.
 *   §10 Layoff attestation — the employer reported a recent layoff in this occupation.
 *   §7  Employer facts     — self-reported headcount and founding year on every PERM filing.
 *
 * All three are read-only derivations of columns already loaded, so they cost one indexed lookup
 * each and no new ingest.
 */

import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"
import { bareSocCode } from "@/lib/salaries/soc-classifier"

// ---------------------------------------------------------------------------
// §9 — SOC override
// ---------------------------------------------------------------------------

/**
 * Corpus-wide share of determinations where DOL assigned a different occupation than the
 * employer requested: 25,097 of 142,634 comparable filings.
 *
 * ⚠ This MUST be computed on bare SOC codes. SUGGESTED_SOC_CODE carries the O*NET '.00' suffix
 * and PWD_SOC_CODE does not, so a raw string comparison reports 99.99% and is meaningless. The
 * `soc_overridden` column is computed correctly at import time — read it, never re-derive.
 */
export const SOC_OVERRIDE_BASELINE = 0.176

/** Below this, a per-employer rate is noise. */
const MIN_OVERRIDE_FILINGS = 10

/** p90 of per-employer rates among employers with >= 10 filings. Above this is genuinely unusual. */
const ELEVATED_OVERRIDE_RATE = 0.4

export interface SocOverrideSignal {
  filings: number
  overridden: number
  rate: number
  baseline: number
  /** Materially above the corpus norm, on a large enough sample to mean something. */
  isElevated: boolean
}

/**
 * How often DOL reclassified this employer's requested occupation.
 *
 * Interpretation is deliberately soft downstream: a high rate is consistent with systematically
 * requesting a cheaper classification, but it is also consistent with genuinely unusual hybrid
 * roles, and DOL reclassifies ~18% of all filings as a matter of course. It is context, not an
 * accusation of wage suppression.
 */
export async function getSocOverrideSignal(input: {
  employerNormalized: string
}): Promise<SocOverrideSignal | null> {
  if (!hasPostgresEnv()) return null
  const norm = input.employerNormalized?.trim()
  if (!norm) return null

  try {
    const { rows } = await getPostgresPool().query<{ filings: string; overridden: string }>(
      `SELECT count(*) FILTER (WHERE soc_overridden IS NOT NULL) AS filings,
              count(*) FILTER (WHERE soc_overridden)             AS overridden
         FROM pwd_records
        WHERE employer_name_normalized = $1`,
      [norm]
    )
    const r = rows[0]
    if (!r) return null
    const filings = Number(r.filings)
    if (filings < MIN_OVERRIDE_FILINGS) return null

    const overridden = Number(r.overridden)
    const rate = overridden / filings
    return {
      filings,
      overridden,
      rate,
      baseline: SOC_OVERRIDE_BASELINE,
      isElevated: rate >= ELEVATED_OVERRIDE_RATE,
    }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// §10 — layoff attestation
// ---------------------------------------------------------------------------

export interface LayoffAttestation {
  socCode: string | null
  socTitle: string | null
  worksiteState: string | null
  /** Decision date of the filing carrying the attestation. */
  decisionDate: string | null
}

/**
 * PERM filings where the employer attested a layoff in this or a related occupation in the six
 * months before filing (OTHER_REQ_EMP_LAYOFF).
 *
 * WHY THIS IS DIFFERENT FROM WARN: WARN notices are company-level, state-fragmented and have no
 * national source. This is occupation-specific, federal, and attested by the employer. It is also
 * rare — only 114 employers across 70 occupations in the loaded corpus — so it will seldom fire,
 * which is appropriate for a signal this strong.
 *
 * ⚠ POINT-IN-TIME. The attestation describes the six months BEFORE that filing, not today. Copy
 * must anchor it to the filing date rather than implying an ongoing layoff.
 */
export async function getLayoffAttestations(input: {
  employerNormalized: string
  socCode?: string | null
  limit?: number
}): Promise<LayoffAttestation[]> {
  if (!hasPostgresEnv()) return []
  const norm = input.employerNormalized?.trim()
  if (!norm) return []

  const soc = bareSocCode(input.socCode)
  const params: unknown[] = [norm]
  let extra = ""
  if (soc) {
    params.push(`${soc}%`)
    extra = ` AND pwd_soc_code LIKE $${params.length}`
  }
  params.push(Math.min(Math.max(input.limit ?? 3, 1), 20))

  try {
    const { rows } = await getPostgresPool().query<{
      pwd_soc_code: string | null; pwd_soc_title: string | null
      worksite_state: string | null; decision_date: string | null
    }>(
      `SELECT pwd_soc_code, pwd_soc_title, worksite_state, decision_date::text
         FROM perm_records
        WHERE employer_name_normalized = $1
          AND employer_layoff${extra}
        ORDER BY decision_date DESC NULLS LAST
        LIMIT $${params.length}`,
      params
    )
    return rows.map((r) => ({
      socCode: r.pwd_soc_code,
      socTitle: r.pwd_soc_title,
      worksiteState: r.worksite_state,
      decisionDate: r.decision_date,
    }))
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// §7 — employer facts
// ---------------------------------------------------------------------------

export interface EmployerFilingFacts {
  /** Self-reported employees on payroll, from the most recent filing that stated it. */
  headcount: number | null
  /** Decision date of the filing that headcount came from. */
  headcountAsOf: string | null
  yearCommenced: number | null
}

/**
 * ⚠⚠ DO NOT SURFACE THIS. Kept only so the measurement below is not lost and nobody rebuilds it.
 *
 * The idea — a free per-FEIN headcount series from EMP_NUM_PAYROLL — does not survive contact
 * with the data. The field is filled inconsistently: sometimes company-wide, sometimes the
 * worksite, sometimes nonsense. Measured spread WITHIN a single employer:
 *
 *   Microsoft   118 – 77,400      (median 55,714)
 *   Amazon    1,729 – 1,061,055   (median 6,700)     <- 600x, and the median is ~1% of reality
 *   Apple        23 – 45,632      (median 43,712)
 *
 * Taking the latest filing (the obvious approach) is the worst estimator of the lot: it reported
 * Microsoft at 2,443 employees. Neither the latest value, the median, nor a trend is defensible,
 * and a visibly wrong headcount on a job page costs more credibility than the fact is worth.
 *
 * A trajectory is doubly impossible today anyway: of 29,311 employers reporting headcount, only
 * 3,127 have two distinct filing years and ZERO have three, because one quarterly file is loaded.
 */
export async function getEmployerFilingFacts(input: {
  employerNormalized: string
}): Promise<EmployerFilingFacts | null> {
  if (!hasPostgresEnv()) return null
  const norm = input.employerNormalized?.trim()
  if (!norm) return null

  try {
    const { rows } = await getPostgresPool().query<{
      headcount: number | null; as_of: string | null; year_commenced: number | null
    }>(
      `SELECT emp_num_payroll AS headcount,
              decision_date::text AS as_of,
              emp_year_commenced AS year_commenced
         FROM perm_records
        WHERE employer_name_normalized = $1
          AND emp_num_payroll IS NOT NULL AND emp_num_payroll > 0
        ORDER BY decision_date DESC NULLS LAST
        LIMIT 1`,
      [norm]
    )
    const r = rows[0]
    if (!r) return null
    return {
      headcount: r.headcount,
      headcountAsOf: r.as_of,
      yearCommenced: r.year_commenced,
    }
  } catch {
    return null
  }
}
