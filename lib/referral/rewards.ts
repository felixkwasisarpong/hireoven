import type { Pool } from "pg"

const REFERRER_REWARD_DAYS = 14
const REFEREE_REWARD_DAYS = 7
const MAX_REFERRAL_REWARDS = 3

/** Grant the referee a 7-day Pro trial. Idempotent. */
export async function grantRefereeReward(pool: Pool, referralId: string, refereeId: string) {
  // Mark granted on the referral row (idempotency guard)
  const updated = await pool.query(
    `UPDATE referrals
        SET referee_reward_granted_at = now()
      WHERE id = $1
        AND referee_reward_granted_at IS NULL
      RETURNING id`,
    [referralId]
  )
  if (updated.rowCount === 0) return // already granted

  // Cancel any existing trial/free sub for this user then insert a fresh Pro trial
  await pool.query(
    `UPDATE subscriptions
        SET status = 'canceled', updated_at = now()
      WHERE user_id = $1
        AND status IN ('trialing')
        AND plan = 'pro'`,
    [refereeId]
  )
  await pool.query(
    `INSERT INTO subscriptions
       (user_id, plan, status, billing_interval, current_period_end, trial_end, created_at, updated_at)
     VALUES
       ($1, 'pro', 'trialing', 'monthly',
        now() + ($2 || ' days')::interval,
        now() + ($2 || ' days')::interval,
        now(), now())`,
    [refereeId, REFEREE_REWARD_DAYS]
  )
}

/**
 * Grant the referrer 14 days of Pro.
 * - If they're on a paid plan: extend current_period_end.
 * - If they're free: insert a trialing Pro subscription.
 * Respects the 3-referral cap.
 */
export async function grantReferrerReward(pool: Pool, referralId: string, referrerId: string) {
  // Cap check: how many converted referrals does this user already have?
  const capCheck = await pool.query<{ count: string }>(
    `SELECT COUNT(*) AS count
       FROM referrals
      WHERE referrer_id = $1
        AND referrer_reward_granted_at IS NOT NULL`,
    [referrerId]
  )
  const earned = parseInt(capCheck.rows[0]?.count ?? "0", 10)
  if (earned >= MAX_REFERRAL_REWARDS) return // cap hit

  // Idempotency guard
  const updated = await pool.query(
    `UPDATE referrals
        SET referrer_reward_granted_at = now(),
            status = 'converted',
            converted_at = now()
      WHERE id = $1
        AND referrer_reward_granted_at IS NULL
      RETURNING id`,
    [referralId]
  )
  if (updated.rowCount === 0) return // already processed

  // Try to extend an existing active/trialing subscription first
  const extended = await pool.query(
    `UPDATE subscriptions
        SET current_period_end = GREATEST(current_period_end, now()) + ($1 || ' days')::interval,
            updated_at = now()
      WHERE user_id = $2
        AND status IN ('active', 'trialing')
        AND (current_period_end IS NULL OR current_period_end > now())
      RETURNING id`,
    [REFERRER_REWARD_DAYS, referrerId]
  )

  if ((extended.rowCount ?? 0) === 0) {
    // Free user — create a fresh Pro trial
    await pool.query(
      `INSERT INTO subscriptions
         (user_id, plan, status, billing_interval, current_period_end, trial_end, created_at, updated_at)
       VALUES
         ($1, 'pro', 'trialing', 'monthly',
          now() + ($2 || ' days')::interval,
          now() + ($2 || ' days')::interval,
          now(), now())`,
      [referrerId, REFERRER_REWARD_DAYS]
    )
  }
}

/**
 * Process all pending referrals where the referee account is at least 7 days old.
 * Called by the daily cron. Returns the number of referrals converted.
 */
export async function processPendingReferrals(pool: Pool): Promise<number> {
  const pending = await pool.query<{ id: string; referrer_id: string; referee_id: string }>(
    `SELECT r.id, r.referrer_id, r.referee_id
       FROM referrals r
      WHERE r.status = 'pending'
        AND r.referee_reward_granted_at IS NOT NULL
        AND r.referrer_reward_granted_at IS NULL
        AND r.created_at < now() - interval '7 days'`
  )

  for (const row of pending.rows) {
    await grantReferrerReward(pool, row.id, row.referrer_id)
  }

  return pending.rows.length
}
