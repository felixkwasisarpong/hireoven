import { getPostgresPool } from "@/lib/postgres/server"

export const FREE_DAILY_SCOUT_QUOTA = 5

export type QuotaState = {
  used: number
  limit: number
  remaining: number
  exceeded: boolean
}

/**
 * Atomically increments the user's daily Scout message counter and returns the
 * post-increment state. The caller decides whether to fulfill or 429 based on
 * `exceeded`. We always increment so a user that hits the limit can't bypass it
 * by retrying — we count attempts, not successes.
 */
export async function bumpScoutUsage(userId: string): Promise<QuotaState> {
  const pool = getPostgresPool()
  const { rows } = await pool.query<{ count: number }>(
    `INSERT INTO scout_usage_daily (user_id, day, count, updated_at)
     VALUES ($1, CURRENT_DATE, 1, now())
     ON CONFLICT (user_id, day)
     DO UPDATE SET count = scout_usage_daily.count + 1, updated_at = now()
     RETURNING count`,
    [userId]
  )
  const used = rows[0]?.count ?? 1
  const limit = FREE_DAILY_SCOUT_QUOTA
  return {
    used,
    limit,
    remaining: Math.max(0, limit - used),
    exceeded: used > limit,
  }
}
