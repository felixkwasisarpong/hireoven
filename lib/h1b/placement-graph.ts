/**
 * §6 Third-Party Placement X-Ray — "this Google job is actually Infosys".
 *
 * SECONDARY_ENTITY_BUSINESS_NAME on the LCA names the END CLIENT a worker is placed at, and
 * ~17.7% of filings carry one (77,597 of 437,496 in FY2026 Q3, across 15,951 distinct clients).
 * Candidates routinely don't discover the employer-of-record arrangement until late: your visa,
 * your salary band and your layoff exposure follow the staffing firm, not the logo on the badge.
 *
 * Two directions, both useful:
 *   employer -> end clients   "this firm places at 340 companies; here they are"
 *   end client -> employers   "who staffs into this company"
 *
 * DATA QUALITY: this is a free-text field and a meaningful share of it is not a company at all.
 * Measured against the real distribution, the top values include 'beneficiary s residence' (853),
 * 'home address' (578), 'remote' (472) and 'home office' (284) — these describe a WORKSITE, not a
 * client, and would otherwise render as "places workers at Home Address". isRealEndClient() drops
 * them. Filtering happens after aggregation so the predicate stays a single testable function
 * rather than a regex duplicated into SQL.
 */

import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"

/**
 * Values that describe where someone sits rather than who they sit at. Derived from the observed
 * top of the distribution, not guessed.
 */
const NON_COMPANY_PATTERNS: RegExp[] = [
  /\bbeneficiar(y|ies)\b/, // 'beneficiary s residence', 'beneficiary residence'
  /^home( address| office| based| location)?$/,
  /^remote( location| work| site| worksite)?$/,
  /^(various|multiple)( locations| sites| clients)?$/,
  /^client( location| site| office| place)?$/,
  /^end client$/,
  /^(n a|na|none|not applicable|nil|null|tbd|unknown|confidential|self|same as above|same as employer)$/,
  /^(employer|petitioner)( s)? (office|location|site|hq|headquarters)$/,
  /^(telecommut\w*|work from home|wfh)$/,
  /^(united states|usa|us)$/,
]

/** Is this end-client value plausibly a real company? */
export function isRealEndClient(normalizedName: string | null | undefined): boolean {
  const n = (normalizedName ?? "").trim()
  if (n.length < 2) return false
  // A bare number or a single letter is never a company name.
  if (/^\d+$/.test(n)) return false
  return !NON_COMPANY_PATTERNS.some((re) => re.test(n))
}

export interface EndClient {
  endClientNormalized: string
  endClientName: string
  filings: number
  positions: number
  lastSeenAt: string | null
}

export interface PlacementEmployer {
  employerNormalized: string
  employerName: string
  filings: number
  positions: number
  isDependent: boolean | null
  lastSeenAt: string | null
}

const DEFAULT_LIMIT = 25
const MAX_LIMIT = 200
/** Over-fetch so post-aggregation junk filtering still fills the requested limit. */
const FETCH_MULTIPLIER = 3

/** End clients this employer places workers at, most-placed first. */
export async function getEndClientsForEmployer(input: {
  employerNormalized: string
  limit?: number
}): Promise<EndClient[]> {
  if (!hasPostgresEnv()) return []
  const norm = input.employerNormalized?.trim()
  if (!norm) return []
  const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)

  try {
    const { rows } = await getPostgresPool().query<{
      n: string; name: string; filings: string; positions: string | null; last_seen: string | null
    }>(
      `SELECT secondary_entity_normalized AS n,
              min(secondary_entity_name)  AS name,
              count(*)                    AS filings,
              sum(total_worker_positions) AS positions,
              max(decision_date)::text    AS last_seen
         FROM lca_records
        WHERE employer_name_normalized = $1
          AND secondary_entity_normalized IS NOT NULL
        GROUP BY secondary_entity_normalized
        ORDER BY count(*) DESC
        LIMIT $2`,
      [norm, limit * FETCH_MULTIPLIER]
    )

    return rows
      .filter((r) => isRealEndClient(r.n))
      .slice(0, limit)
      .map((r) => ({
        endClientNormalized: r.n,
        endClientName: r.name,
        filings: Number(r.filings),
        positions: Number(r.positions ?? 0),
        lastSeenAt: r.last_seen,
      }))
  } catch {
    return []
  }
}

/** Staffing firms that place workers INTO this company. */
export async function getEmployersPlacingAt(input: {
  endClientNormalized: string
  limit?: number
}): Promise<PlacementEmployer[]> {
  if (!hasPostgresEnv()) return []
  const norm = input.endClientNormalized?.trim()
  if (!norm || !isRealEndClient(norm)) return []
  const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)

  try {
    const { rows } = await getPostgresPool().query<{
      n: string; name: string; filings: string; positions: string | null
      dependent: boolean | null; last_seen: string | null
    }>(
      `SELECT employer_name_normalized AS n,
              min(employer_name)       AS name,
              count(*)                 AS filings,
              sum(total_worker_positions) AS positions,
              bool_or(h1b_dependent)   AS dependent,
              max(decision_date)::text AS last_seen
         FROM lca_records
        WHERE secondary_entity_normalized = $1
          AND employer_name_normalized IS NOT NULL
        GROUP BY employer_name_normalized
        ORDER BY count(*) DESC
        LIMIT $2`,
      [norm, limit]
    )

    return rows.map((r) => ({
      employerNormalized: r.n,
      employerName: r.name,
      filings: Number(r.filings),
      positions: Number(r.positions ?? 0),
      isDependent: r.dependent,
      lastSeenAt: r.last_seen,
    }))
  } catch {
    return []
  }
}

export interface PlacementProfile {
  /** Filings where this employer named an end client. */
  placementFilings: number
  totalFilings: number
  /** Share of filings that are third-party placements. */
  placementShare: number
  distinctEndClients: number
  topEndClients: EndClient[]
  isDependent: boolean | null
}

/**
 * Is this employer a staffing/placement shop, and where do they place? Returns null when the
 * employer has no filings, and a zero-placement profile when they file but never name a client.
 */
export async function getPlacementProfile(input: {
  employerNormalized: string
  topN?: number
}): Promise<PlacementProfile | null> {
  if (!hasPostgresEnv()) return null
  const norm = input.employerNormalized?.trim()
  if (!norm) return null

  try {
    const { rows } = await getPostgresPool().query<{
      placements: string; total: string; distinct_clients: string; dependent: boolean | null
    }>(
      `SELECT count(*) FILTER (WHERE secondary_entity_normalized IS NOT NULL) AS placements,
              count(*)                                                       AS total,
              count(DISTINCT secondary_entity_normalized)                    AS distinct_clients,
              bool_or(h1b_dependent)                                         AS dependent
         FROM lca_records
        WHERE employer_name_normalized = $1`,
      [norm]
    )
    const r = rows[0]
    if (!r) return null
    const total = Number(r.total)
    if (!total) return null

    const placements = Number(r.placements)
    const topEndClients = placements > 0
      ? await getEndClientsForEmployer({ employerNormalized: norm, limit: input.topN ?? 5 })
      : []

    return {
      placementFilings: placements,
      totalFilings: total,
      placementShare: placements / total,
      distinctEndClients: Number(r.distinct_clients),
      topEndClients,
      isDependent: r.dependent,
    }
  } catch {
    return null
  }
}
