// Server-only — uses pg. Importing from a client component will fail the bundler
// with "Module not found: Can't resolve 'fs'". Use lib/usage/quotas (types/config)
// or lib/hooks/useQuotas (client) on the client side.
import { getPostgresPool } from "@/lib/postgres/server"
import type { Plan } from "@/lib/gates"
import { tryConsumePackCredit } from "@/lib/billing/packs-server"
import {
  FEATURE_QUOTAS,
  METERED_FEATURE_KEYS,
  type MeteredFeature,
  type QuotaPeriod,
  type QuotaState,
} from "./quotas"

function periodStartSql(period: QuotaPeriod): string {
  return period === "day"
    ? "CURRENT_DATE"
    : "date_trunc('month', now())::date"
}

function limitFor(feature: MeteredFeature, plan: Plan | null): number {
  return FEATURE_QUOTAS[feature].limits[plan ?? "free"]
}

/**
 * Atomically increments the user's usage for `feature` in the current period and
 * returns the post-increment state. Always increments — callers decide whether
 * to fulfil or 429 based on `exceeded`. We count attempts, not successes, so
 * retries cannot bypass the cap.
 *
 * If the user is over their base quota, we attempt to consume one credit from
 * the oldest non-empty top-up pack instead of marking the call as exceeded.
 * The `used` count still increments — pack usage is tracked separately in
 * feature_credit_pack_consumption.
 */
export async function bumpUsage(
  userId: string,
  feature: MeteredFeature,
  plan: Plan | null
): Promise<QuotaState> {
  const config = FEATURE_QUOTAS[feature]
  const pool = getPostgresPool()
  const { rows } = await pool.query<{ count: number }>(
    `INSERT INTO feature_usage (user_id, feature, period_start, count, updated_at)
     VALUES ($1, $2, ${periodStartSql(config.period)}, 1, now())
     ON CONFLICT (user_id, feature, period_start)
     DO UPDATE SET count = feature_usage.count + 1, updated_at = now()
     RETURNING count`,
    [userId, feature]
  )
  const used = rows[0]?.count ?? 1
  const limit = limitFor(feature, plan)
  const overBase = used > limit

  // Over base quota → try to consume a pack credit. If a pack credit is
  // available, the call is allowed and we return exceeded=false.
  if (overBase) {
    const consumed = await tryConsumePackCredit(userId, feature)
    if (consumed) {
      return {
        feature,
        period: config.period,
        used,
        limit,
        remaining: 0,
        exceeded: false,
        paidWithPack: true,
      }
    }
  }

  return {
    feature,
    period: config.period,
    used,
    limit,
    remaining: Math.max(0, limit - used),
    exceeded: overBase,
    paidWithPack: false,
  }
}

export async function getUsage(
  userId: string,
  feature: MeteredFeature,
  plan: Plan | null
): Promise<QuotaState> {
  const config = FEATURE_QUOTAS[feature]
  const pool = getPostgresPool()
  const { rows } = await pool.query<{ count: number }>(
    `SELECT count FROM feature_usage
     WHERE user_id = $1
       AND feature = $2
       AND period_start = ${periodStartSql(config.period)}`,
    [userId, feature]
  )
  const used = rows[0]?.count ?? 0
  const limit = limitFor(feature, plan)
  return {
    feature,
    period: config.period,
    used,
    limit,
    remaining: Math.max(0, limit - used),
    exceeded: used >= limit,
  }
}

export async function getAllQuotas(
  userId: string,
  plan: Plan | null
): Promise<Record<MeteredFeature, QuotaState>> {
  const states = await Promise.all(
    METERED_FEATURE_KEYS.map((f) => getUsage(userId, f, plan))
  )
  return states.reduce((acc, state) => {
    acc[state.feature] = state
    return acc
  }, {} as Record<MeteredFeature, QuotaState>)
}
