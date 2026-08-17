/**
 * §4 Transfer Velocity — which employers actually file H-1B transfers, how many, and how fast.
 *
 * WHY THIS IS ONLY POSSIBLE FROM DOL: the LCA form splits TOTAL_WORKER_POSITIONS into six
 * integer counts, and CHANGE_EMPLOYER > 0 is an H-1B transfer. The USCIS Employer Data Hub —
 * the source every competitor uses — buries transfers inside "Continuing Approval" alongside
 * extensions and amendments, so per-employer transfer volume cannot be recovered from it.
 * Here it is a GROUP BY. Measured on FY2026 Q3: 75,939 transfer filings / 140,199 positions.
 *
 * WHAT IT POWERS: a laid-off H-1B worker's only real question is "who can file for me fast
 * enough". Ranked recent transfer volume in their occupation and metro answers it with filings
 * rather than reputation.
 *
 * Keyed on employer_name_normalized rather than company_id: only ~3% of transfer rows are linked
 * to a company today (entity resolution is a separate, ongoing job), so keying on company_id
 * would silently hide 97% of the signal. We LEFT JOIN companies to enrich where a link exists.
 *
 * Web-box safe: filters hit the partial indexes created in
 * scripts/migrations/add-lca-transfer-and-secondary-entity.sql, and every query is bounded.
 */

import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"

export interface TransferEmployer {
  employerName: string
  employerNormalized: string
  /** Filings with CHANGE_EMPLOYER > 0 in the window. */
  transferFilings: number
  /** Sum of CHANGE_EMPLOYER — i.e. workers transferred in, not applications. */
  transferPositions: number
  /** Median DECISION_DATE - RECEIVED_DATE in days. Null when dates are missing. */
  medianDecisionDays: number | null
  /** Most recent transfer decision in the window. */
  lastTransferAt: string | null
  companyId: string | null
  companyName: string | null
  companyDomain: string | null
  isCapExempt: boolean | null
}

export interface TransferQuery {
  /** SOC prefix to match, e.g. '15-1252' or the broader '15-12'. Optional. */
  socPrefix?: string | null
  /** Two-letter worksite state. Optional. */
  stateAbbr?: string | null
  /** Look-back window. */
  sinceDays?: number
  limit?: number
}

const DEFAULT_SINCE_DAYS = 365
const DEFAULT_LIMIT = 25
const MAX_LIMIT = 100

/**
 * Employers ranked by H-1B transfers filed in the window, optionally scoped to an occupation
 * and state. This is the "who can actually move me" list.
 */
export async function getTransferFriendlyEmployers(query: TransferQuery = {}): Promise<TransferEmployer[]> {
  if (!hasPostgresEnv()) return []

  const sinceDays = Math.min(Math.max(query.sinceDays ?? DEFAULT_SINCE_DAYS, 1), 365 * 5)
  const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)

  const soc = (query.socPrefix ?? "").trim()
  const state = (query.stateAbbr ?? "").trim().toUpperCase()
  if (soc && !/^\d{2}(-\d{2,4})?$/.test(soc)) return []
  if (state && !/^[A-Z]{2}$/.test(state)) return []

  const params: unknown[] = [sinceDays]
  let filter = ""
  if (soc) {
    params.push(`${soc}%`)
    filter += ` AND l.soc_code LIKE $${params.length}`
  }
  if (state) {
    params.push(state)
    filter += ` AND l.worksite_state_abbr = $${params.length}`
  }
  params.push(limit)

  try {
    const { rows } = await getPostgresPool().query<{
      employer_name: string
      employer_name_normalized: string
      filings: string
      positions: string
      median_days: string | null
      last_transfer: string | null
      company_id: string | null
      company_name: string | null
      company_domain: string | null
      is_cap_exempt: boolean | null
    }>(
      `WITH t AS (
         SELECT l.employer_name_normalized,
                min(l.employer_name)                       AS employer_name,
                count(*)                                   AS filings,
                sum(l.change_employer)                     AS positions,
                max(l.decision_date)                       AS last_transfer,
                percentile_cont(0.5) WITHIN GROUP (
                  ORDER BY (l.decision_date - l.received_date)
                ) FILTER (WHERE l.received_date IS NOT NULL
                           AND l.decision_date IS NOT NULL
                           AND l.decision_date >= l.received_date) AS median_days,
                (array_agg(l.company_id) FILTER (WHERE l.company_id IS NOT NULL))[1] AS company_id
           FROM lca_records l
          WHERE l.change_employer > 0
            AND l.decision_date >= (CURRENT_DATE - ($1::int || ' days')::interval)
            AND l.employer_name_normalized IS NOT NULL
            ${filter}
          GROUP BY l.employer_name_normalized
       )
       SELECT t.employer_name, t.employer_name_normalized,
              t.filings::text, t.positions::text,
              round(t.median_days)::text AS median_days,
              t.last_transfer::text,
              t.company_id::text,
              c.name AS company_name, c.domain AS company_domain, c.is_cap_exempt
         FROM t
         LEFT JOIN companies c ON c.id = t.company_id
        ORDER BY t.positions DESC NULLS LAST, t.filings DESC
        LIMIT $${params.length}`,
      params
    )

    return rows.map((r) => ({
      employerName: r.company_name ?? r.employer_name,
      employerNormalized: r.employer_name_normalized,
      transferFilings: Number(r.filings),
      transferPositions: Number(r.positions ?? 0),
      medianDecisionDays: r.median_days === null ? null : Number(r.median_days),
      lastTransferAt: r.last_transfer,
      companyId: r.company_id,
      companyName: r.company_name,
      companyDomain: r.company_domain,
      isCapExempt: r.is_cap_exempt,
    }))
  } catch {
    return []
  }
}

/**
 * Minimum distinct employers before a role x state page is worth putting in the index.
 * Below this the page is thin — a table with two rows ranking "who can transfer you" is not a
 * useful answer, and thin programmatic pages are an indexing liability rather than an asset.
 * Measured: 396 of the featured-role slices clear 5, and 292 clear 10.
 */
export const MIN_EMPLOYERS_FOR_INDEX = 5

export interface TransferSlice {
  socGroup: string
  stateAbbr: string
  employers: number
}

/**
 * Role x state slices with enough transfer activity to justify a standalone page.
 * Drives generateStaticParams and the sitemap, so both agree on what exists.
 */
export async function getIndexableTransferSlices(input: {
  socGroups: string[]
  sinceDays?: number
}): Promise<TransferSlice[]> {
  if (!hasPostgresEnv()) return []
  const socs = (input.socGroups ?? []).filter((s) => /^\d{2}-\d{2,4}$/.test(s))
  if (!socs.length) return []
  const sinceDays = Math.min(Math.max(input.sinceDays ?? DEFAULT_SINCE_DAYS, 1), 365 * 5)

  try {
    const { rows } = await getPostgresPool().query<{ soc: string; st: string; employers: string }>(
      `SELECT left(soc_code, 5) AS soc, worksite_state_abbr AS st,
              count(DISTINCT employer_name_normalized)::text AS employers
         FROM lca_records
        WHERE change_employer > 0
          AND decision_date >= (CURRENT_DATE - ($1::int || ' days')::interval)
          AND worksite_state_abbr IS NOT NULL
          AND left(soc_code, 5) = ANY($2::text[])
        GROUP BY 1, 2
       HAVING count(DISTINCT employer_name_normalized) >= $3`,
      [sinceDays, socs, MIN_EMPLOYERS_FOR_INDEX]
    )
    return rows.map((r) => ({ socGroup: r.soc, stateAbbr: r.st, employers: Number(r.employers) }))
  } catch {
    return []
  }
}

export interface CompanyTransferProfile {
  transferFilings: number
  transferPositions: number
  medianDecisionDays: number | null
  lastTransferAt: string | null
  /** Share of this employer's filings in the window that are transfers. */
  transferShare: number | null
  totalFilings: number
}

/** Transfer posture for one employer, for a company page or a job-detail badge. */
export async function getCompanyTransferProfile(input: {
  employerNormalized: string
  sinceDays?: number
}): Promise<CompanyTransferProfile | null> {
  if (!hasPostgresEnv()) return null
  const norm = input.employerNormalized?.trim()
  if (!norm) return null
  const sinceDays = Math.min(Math.max(input.sinceDays ?? DEFAULT_SINCE_DAYS, 1), 365 * 5)

  try {
    const { rows } = await getPostgresPool().query<{
      filings: string
      positions: string | null
      median_days: string | null
      last_transfer: string | null
      total: string
    }>(
      `SELECT count(*) FILTER (WHERE change_employer > 0)                    AS filings,
              sum(change_employer)                                          AS positions,
              round(percentile_cont(0.5) WITHIN GROUP (
                ORDER BY (decision_date - received_date)
              ) FILTER (WHERE change_employer > 0
                         AND received_date IS NOT NULL
                         AND decision_date IS NOT NULL
                         AND decision_date >= received_date))::text         AS median_days,
              max(decision_date) FILTER (WHERE change_employer > 0)::text   AS last_transfer,
              count(*)                                                      AS total
         FROM lca_records
        WHERE employer_name_normalized = $1
          AND decision_date >= (CURRENT_DATE - ($2::int || ' days')::interval)`,
      [norm, sinceDays]
    )
    const r = rows[0]
    if (!r) return null
    const filings = Number(r.filings)
    const total = Number(r.total)
    if (!total) return null

    return {
      transferFilings: filings,
      transferPositions: Number(r.positions ?? 0),
      medianDecisionDays: r.median_days === null ? null : Number(r.median_days),
      lastTransferAt: r.last_transfer,
      transferShare: total > 0 ? filings / total : null,
      totalFilings: total,
    }
  } catch {
    return null
  }
}
