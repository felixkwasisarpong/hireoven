import { getPostgresPool } from "@/lib/postgres/server"
import type { CompanyHiringHealth } from "@/types"

type LayoffSummaryRow = {
  total_layoff_events: number
  total_employees_affected: number | null
  days_since_last_layoff: number | null
  has_active_freeze: boolean
  freeze_confidence: "confirmed" | "likely" | "possible" | null
  layoff_trend: "accelerating" | "stable" | "recovering"
  most_recent_layoff_date: string | null
}

/**
 * Computes the score penalty from layoff data for a company.
 * Returns 0 if no layoff data exists.
 *
 * Confirmed active freeze: −25
 * Likely active freeze:    −18
 * Possible active freeze:  −10
 * Accelerating trend:      −10 (additive)
 * Recovering (91-180d):    −5
 */
export function computeLayoffPenalty(summary: LayoffSummaryRow | null): number {
  if (!summary || !summary.has_active_freeze) {
    if (summary?.layoff_trend === "recovering") return -5
    return 0
  }
  let penalty = 0
  if (summary.freeze_confidence === "confirmed") penalty -= 25
  else if (summary.freeze_confidence === "likely") penalty -= 18
  else penalty -= 10
  if (summary.layoff_trend === "accelerating") penalty -= 10
  return penalty
}

/**
 * Fetches the company_layoff_summary and enriches the given
 * CompanyHiringHealth object with layoff signals + score penalty.
 * Returns the enriched object (mutated in place and returned).
 * Never throws — returns the original object unchanged on error.
 */
export async function enrichWithLayoffData(
  health: CompanyHiringHealth,
  companyId: string
): Promise<CompanyHiringHealth> {
  try {
    const pool = getPostgresPool()
    const { rows } = await pool.query<LayoffSummaryRow>(
      `SELECT total_layoff_events, total_employees_affected, days_since_last_layoff,
              has_active_freeze, freeze_confidence, layoff_trend, most_recent_layoff_date
       FROM company_layoff_summary
       WHERE company_id = $1
       LIMIT 1`,
      [companyId]
    )
    const summary = rows[0] ?? null
    const penalty = computeLayoffPenalty(summary)

    // Enrich the health object
    health.recentLayoffCount = summary?.total_layoff_events ?? null
    health.employeesAffected = summary?.total_employees_affected ?? null
    health.daysSinceLastLayoff = summary?.days_since_last_layoff ?? null
    health.hasActiveFreezeFromLayoffs = summary?.has_active_freeze ?? null
    health.freezeConfidence = summary?.freeze_confidence ?? null
    health.layoffTrend = summary?.layoff_trend ?? null

    // Apply score penalty
    if (penalty !== 0 && health.score != null) {
      health.score = Math.max(0, Math.min(100, health.score + penalty))
    }

    // Update status based on freeze
    if (summary?.has_active_freeze && health.status !== "slowing") {
      health.status = "slowing"
    }
  } catch { /* Non-critical — return original health unchanged */ }

  return health
}

/**
 * Builds a CompanyHiringHealth-compatible layoff signal summary.
 * Used when building health from scratch without existing data.
 */
export async function getLayoffHealthFields(
  companyId: string
): Promise<Partial<CompanyHiringHealth>> {
  try {
    const pool = getPostgresPool()
    const { rows } = await pool.query<LayoffSummaryRow>(
      `SELECT total_layoff_events, total_employees_affected, days_since_last_layoff,
              has_active_freeze, freeze_confidence, layoff_trend, most_recent_layoff_date
       FROM company_layoff_summary
       WHERE company_id = $1
       LIMIT 1`,
      [companyId]
    )
    const s = rows[0]
    if (!s) return {}
    return {
      recentLayoffCount: s.total_layoff_events,
      employeesAffected: s.total_employees_affected,
      daysSinceLastLayoff: s.days_since_last_layoff,
      hasActiveFreezeFromLayoffs: s.has_active_freeze,
      freezeConfidence: s.freeze_confidence,
      layoffTrend: s.layoff_trend,
    }
  } catch { return {} }
}
