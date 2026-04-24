import { getPostgresPool } from "@/lib/postgres/server"
import { getPlanAmountCents } from "@/lib/pricing"

export async function startTrial(
  userId: string,
  plan: "pro" | "pro_international",
  interval: "monthly" | "yearly",
  trialEnd: Date,
  stripeSubscriptionId: string,
  stripeCustomerId: string
): Promise<void> {
  const pool = getPostgresPool()

  await pool.query(
    `INSERT INTO subscriptions (
      user_id,
      plan,
      status,
      stripe_subscription_id,
      stripe_customer_id,
      billing_interval,
      amount_cents,
      current_period_start,
      current_period_end,
      trial_end,
      updated_at
    ) VALUES (
      $1, $2, 'trialing', $3, $4, $5, $6, $7, $8, $9, $10
    )
    ON CONFLICT (stripe_subscription_id)
    DO UPDATE SET
      user_id = EXCLUDED.user_id,
      plan = EXCLUDED.plan,
      status = EXCLUDED.status,
      stripe_customer_id = EXCLUDED.stripe_customer_id,
      billing_interval = EXCLUDED.billing_interval,
      amount_cents = EXCLUDED.amount_cents,
      current_period_start = EXCLUDED.current_period_start,
      current_period_end = EXCLUDED.current_period_end,
      trial_end = EXCLUDED.trial_end,
      updated_at = EXCLUDED.updated_at`,
    [
      userId,
      plan,
      stripeSubscriptionId,
      stripeCustomerId,
      interval,
      getPlanAmountCents(plan, interval),
      new Date().toISOString(),
      trialEnd.toISOString(),
      trialEnd.toISOString(),
      new Date().toISOString(),
    ]
  )
}

export async function isInTrial(userId: string): Promise<boolean> {
  const days = await getTrialDaysRemaining(userId)
  return days !== null && days > 0
}

export async function getTrialDaysRemaining(userId: string): Promise<number | null> {
  const pool = getPostgresPool()
  const result = await pool.query<{ current_period_end: string | null }>(
    `SELECT current_period_end
     FROM subscriptions
     WHERE user_id = $1
       AND status = 'trialing'
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId]
  )
  const data = result.rows[0]

  if (!data?.current_period_end) return null

  const end = new Date(data.current_period_end).getTime()
  const now = Date.now()
  if (end <= now) return 0

  return Math.ceil((end - now) / (1000 * 60 * 60 * 24))
}
