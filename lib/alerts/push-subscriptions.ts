import { getPostgresPool } from "@/lib/postgres/server"
import type { WebPushSubscription } from "@/types"

function normalizeSubscription(
  subscription: PushSubscription | WebPushSubscription
): WebPushSubscription {
  const rawValue =
    typeof (subscription as PushSubscription).toJSON === "function"
      ? (subscription as PushSubscription).toJSON()
      : subscription
  const value = rawValue as Partial<WebPushSubscription> | null

  if (
    !value ||
    typeof value.endpoint !== "string" ||
    !value.keys?.auth ||
    !value.keys?.p256dh
  ) {
    throw new Error("Invalid push subscription payload")
  }

  return {
    endpoint: value.endpoint,
    expirationTime: value.expirationTime ?? null,
    keys: {
      auth: value.keys.auth,
      p256dh: value.keys.p256dh,
    },
  }
}

export async function savePushSubscription(
  userId: string,
  subscription: PushSubscription | WebPushSubscription
): Promise<void> {
  const pool = getPostgresPool()
  const normalized = normalizeSubscription(subscription)

  const existing = await pool.query<{ id: string }>(
    `SELECT id FROM push_subscriptions
     WHERE user_id = $1 AND subscription->>'endpoint' = $2
     LIMIT 1`,
    [userId, normalized.endpoint]
  )

  if (existing.rows[0]?.id) {
    await pool.query(`UPDATE push_subscriptions SET subscription = $1::jsonb WHERE id = $2`, [
      normalized,
      existing.rows[0].id,
    ])
    return
  }

  await pool.query(
    `INSERT INTO push_subscriptions (user_id, subscription) VALUES ($1, $2::jsonb)`,
    [userId, normalized]
  )
}

export async function getUserSubscriptions(
  userId: string
): Promise<WebPushSubscription[]> {
  const pool = getPostgresPool()
  const result = await pool.query<{ subscription: WebPushSubscription | null }>(
    `SELECT subscription FROM push_subscriptions WHERE user_id = $1`,
    [userId]
  )

  return result.rows
    .map((row: { subscription: WebPushSubscription | null }) => row.subscription)
    .filter((value: WebPushSubscription | null): value is WebPushSubscription => Boolean(value))
}

export async function removeSubscription(
  subscriptionEndpoint: string
): Promise<void> {
  const pool = getPostgresPool()
  await pool.query(`DELETE FROM push_subscriptions WHERE subscription->>'endpoint' = $1`, [
    subscriptionEndpoint,
  ])
}
