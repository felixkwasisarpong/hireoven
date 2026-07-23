import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"

/**
 * Real per-SOC/state DOL wage-level cutoffs, derived from certified LCA filings.
 *
 * DOL prevailing-wage levels (I–IV) partition the local OES wage distribution, so
 * the *floor* of each level's certified prevailing wages is that level's entry
 * cutoff. We read a low percentile (p05) per level to shrug off unit-typo
 * outliers, then hand the [L2, L3, L4] cutoffs to the lottery engine as
 * `prevailingWageBands` — upgrading a role's wage-level estimate from national
 * "estimated" to local "modeled".
 *
 * Web-box safe: filters on the indexed soc_code + worksite_state_abbr, samples at
 * most 20k rows, and runs under a statement timeout (mirrors lib/salaries/wage-query).
 */

const ANNUAL = `CASE lower(trim(prevailing_wage_unit))
  WHEN 'hour' THEN prevailing_wage*2080
  WHEN 'week' THEN prevailing_wage*52
  WHEN 'bi-weekly' THEN prevailing_wage*26
  WHEN 'month' THEN prevailing_wage*12
  ELSE prevailing_wage END`

const MIN_PER_LEVEL = 5
const MIN_TOTAL = 25

export interface PrevailingWageBands {
  /** [L2 cutoff, L3 cutoff, L4 cutoff] in annual USD. */
  bands: readonly [number, number, number]
  sampleSize: number
  socGroup: string
  stateAbbr: string
}

function roundTo(value: number, step = 1000): number {
  return Math.round(value / step) * step
}

export async function getPrevailingWageBands(input: {
  socGroup: string
  stateAbbr: string
}): Promise<PrevailingWageBands | null> {
  const socGroup = input.socGroup?.trim()
  const stateAbbr = input.stateAbbr?.trim().toUpperCase()
  if (!socGroup || !stateAbbr || !/^\d{2}-\d{2,4}$/.test(socGroup) || !/^[A-Z]{2}$/.test(stateAbbr)) {
    return null
  }
  if (!hasPostgresEnv()) return null

  try {
    const pool = getPostgresPool()
    const client = await pool.connect()
    try {
      await client.query("SET LOCAL statement_timeout = '8s'")
      const { rows } = await client.query<{ wage_level: string; n: string; cutoff: string }>(
        `SELECT wage_level, COUNT(*)::text n,
                ROUND(PERCENTILE_CONT(0.05) WITHIN GROUP (ORDER BY aw))::text cutoff
           FROM (
             SELECT wage_level, ${ANNUAL} AS aw
               FROM lca_records
              WHERE soc_code LIKE $1
                AND worksite_state_abbr = $2
                AND case_status LIKE 'Certified%'
                AND prevailing_wage > 0
                AND wage_level IN ('II','III','IV')
              LIMIT 20000
           ) t
          GROUP BY wage_level`,
        [`${socGroup}%`, stateAbbr]
      )

      const byLevel = new Map(rows.map((r) => [r.wage_level, { n: Number(r.n), cutoff: Number(r.cutoff) }]))
      const l2 = byLevel.get("II")
      const l3 = byLevel.get("III")
      const l4 = byLevel.get("IV")
      if (!l2 || !l3 || !l4) return null
      if (l2.n < MIN_PER_LEVEL || l3.n < MIN_PER_LEVEL || l4.n < MIN_PER_LEVEL) return null

      const total = l2.n + l3.n + l4.n
      if (total < MIN_TOTAL) return null

      // Enforce a monotonic, sane ladder (guards against noisy slices).
      const b2 = roundTo(l2.cutoff)
      const b3 = roundTo(Math.max(l3.cutoff, b2 + 1000))
      const b4 = roundTo(Math.max(l4.cutoff, b3 + 1000))
      if (!(b2 > 0 && b3 > b2 && b4 > b3)) return null

      return { bands: [b2, b3, b4] as const, sampleSize: total, socGroup, stateAbbr }
    } finally {
      client.release()
    }
  } catch {
    return null
  }
}
