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

  // Atomic upsert — prevents duplicate key errors from concurrent registrations
  await pool.query(
    `INSERT INTO push_subscriptions (user_id, subscription)
     VALUES ($1, $2::jsonb)
     ON CONFLICT ((subscription->>'endpoint'))
     DO UPDATE SET subscription = EXCLUDED.subscription, user_id = EXCLUDED.user_id`,
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

/**
 * True when a web-push send error means the subscription can never succeed
 * and should be pruned:
 * - 404/410: endpoint gone (browser unsubscribed / expired)
 * - 400/403 with a VAPID mismatch reason: the subscription was created under
 *   a previous VAPID key pair (Apple: `{"reason":"VapidPkHashMismatch"}`,
 *   FCM: 403 sender mismatch). After a key rotation these fail on every send
 *   forever — deleting them lets the client mint a fresh subscription.
 */
export function isDeadSubscriptionError(error: unknown): boolean {
  const statusCode = (error as { statusCode?: number }).statusCode
  if (statusCode === 404 || statusCode === 410) return true
  if (statusCode === 400 || statusCode === 403) {
    const body = String((error as { body?: unknown }).body ?? "")
    return /vapid/i.test(body)
  }
  return false
}
