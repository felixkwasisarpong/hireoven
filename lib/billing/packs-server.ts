// Server-only — pack credit operations. Used by lib/usage/quotas-server.ts
// (consume on quota overflow) and by the Stripe webhook (grant on purchase).
import { getPostgresPool } from "@/lib/postgres/server"
import type { MeteredFeature } from "@/lib/usage/quotas"
import type { PackKey } from "./packs"

export type PackBalance = {
  feature: MeteredFeature
  remaining: number
  packs: Array<{
    id: string
    packKey: string
    creditsRemaining: number
    creditsGranted: number
    createdAt: string
  }>
}

export async function getPackBalanceForFeature(
  userId: string,
  feature: MeteredFeature
): Promise<PackBalance> {
  const pool = getPostgresPool()
  const result = await pool.query<{
    id: string
    pack_key: string
    credits_remaining: number
    credits_granted: number
    created_at: string
  }>(
    `SELECT id, pack_key, credits_remaining, credits_granted, created_at
     FROM feature_credit_packs
     WHERE user_id = $1 AND feature = $2 AND credits_remaining > 0
       AND (expires_at IS NULL OR expires_at > NOW())
     ORDER BY created_at ASC`,
    [userId, feature]
  )
  const remaining = result.rows.reduce((sum, row) => sum + row.credits_remaining, 0)
  return {
    feature,
    remaining,
    packs: result.rows.map((r) => ({
      id: r.id,
      packKey: r.pack_key,
      creditsRemaining: r.credits_remaining,
      creditsGranted: r.credits_granted,
      createdAt: r.created_at,
    })),
  }
}

/** Atomically consume one credit from the oldest non-empty pack for this
 *  feature. Returns true if a credit was consumed, false if none available. */
export async function tryConsumePackCredit(
  userId: string,
  feature: MeteredFeature
): Promise<boolean> {
  const pool = getPostgresPool()
  const result = await pool.query<{ id: string }>(
    `WITH next_pack AS (
       SELECT id
       FROM feature_credit_packs
       WHERE user_id = $1
         AND feature = $2
         AND credits_remaining > 0
         AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY created_at ASC
       FOR UPDATE SKIP LOCKED
       LIMIT 1
     ),
     decrement AS (
       UPDATE feature_credit_packs
       SET credits_remaining = credits_remaining - 1
       WHERE id = (SELECT id FROM next_pack)
       RETURNING id
     ),
     log AS (
       INSERT INTO feature_credit_pack_consumption (pack_id, user_id, feature, amount)
       SELECT id, $1, $2, 1 FROM decrement
       RETURNING id
     )
     SELECT id FROM decrement`,
    [userId, feature]
  )
  return result.rowCount !== null && result.rowCount > 0
}

export async function grantPackCredits(args: {
  userId: string
  feature: MeteredFeature
  packKey: PackKey
  credits: number
  amountCents: number
  stripePaymentIntentId?: string | null
}): Promise<{ id: string }> {
  const pool = getPostgresPool()
  // Idempotent on Stripe payment intent — Stripe may retry the webhook
  const result = await pool.query<{ id: string }>(
    `INSERT INTO feature_credit_packs
       (user_id, feature, pack_key, credits_granted, credits_remaining, amount_cents, stripe_payment_intent_id)
     VALUES ($1, $2, $3, $4, $4, $5, $6)
     ON CONFLICT (stripe_payment_intent_id) DO UPDATE
       SET pack_key = EXCLUDED.pack_key
     RETURNING id`,
    [
      args.userId,
      args.feature,
      args.packKey,
      args.credits,
      args.amountCents,
      args.stripePaymentIntentId ?? null,
    ]
  )
  return { id: result.rows[0].id }
}
