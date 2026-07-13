import type Stripe from "stripe"
import type { Pool } from "pg"
import { getPlanAmountCents, RESTRICTED_PROMO_CODES, type BillingInterval, type PlanKey } from "@/lib/pricing"
import { getPostgresPool } from "@/lib/postgres/server"
import { grantCredits } from "@/lib/apex/interview/credits"
import { isPackKey, FEATURE_PACKS } from "@/lib/billing/packs"
import { grantPackCredits } from "@/lib/billing/packs-server"

// Shared checkout fulfillment. Called from BOTH the Stripe webhook and the
// return-URL verifier (/api/stripe/verify-session), so a purchase is granted
// even when one of the two paths never fires. Every branch is idempotent:
// re-running fulfillment for the same session must be a no-op.

type StoredSubscriptionStatus = "active" | "trialing" | "canceled" | "past_due" | "unpaid"

export function normalizePlanForPricing(raw: string | null | undefined): PlanKey {
  if (raw === "pro_international") return "pro_max"
  if (raw === "pro" || raw === "pro_max" || raw === "free") return raw
  return "free"
}

function normalizePlanForStorage(plan: PlanKey): "free" | "pro" | "pro_international" {
  if (plan === "pro_max") return "pro_international"
  return plan
}

function getSubscriptionPeriod(sub: any) {
  const firstItem = sub.items?.data?.[0]
  return {
    start: sub.current_period_start ?? firstItem?.current_period_start ?? sub.start_date ?? sub.created,
    end: sub.current_period_end ?? firstItem?.current_period_end ?? sub.trial_end ?? sub.cancel_at ?? sub.ended_at ?? sub.created,
  }
}

export function normalizeStripeSubscriptionStatus(raw: string | null | undefined): StoredSubscriptionStatus {
  switch (raw) {
    case "active":
    case "trialing":
    case "canceled":
    case "past_due":
    case "unpaid":
      return raw
    default:
      return "canceled"
  }
}

export async function upsertSubscriptionRow(
  pool: Pool,
  args: {
    userId: string
    plan: PlanKey
    status: StoredSubscriptionStatus
    stripeSubscriptionId: string
    stripeCustomerId: string
    interval: BillingInterval
    amountCents: number
    currentPeriodStart: Date
    currentPeriodEnd: Date
    trialEnd: Date | null
    cancelAtPeriodEnd: boolean
  },
): Promise<void> {
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
      cancel_at_period_end,
      updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
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
      cancel_at_period_end = EXCLUDED.cancel_at_period_end,
      updated_at = EXCLUDED.updated_at`,
    [
      args.userId,
      normalizePlanForStorage(args.plan),
      args.status,
      args.stripeSubscriptionId,
      args.stripeCustomerId,
      args.interval,
      args.amountCents,
      args.currentPeriodStart.toISOString(),
      args.currentPeriodEnd.toISOString(),
      args.trialEnd ? args.trialEnd.toISOString() : null,
      args.cancelAtPeriodEnd,
      new Date().toISOString(),
    ]
  )
}

export type FulfillmentResult =
  | { kind: "immigration_service"; requestId: string }
  | { kind: "live_interview_credits"; credits: number; granted: boolean }
  | { kind: "feature_credit_pack"; pack: string; credits: number }
  | { kind: "subscription"; plan: "pro" | "pro_max"; interval: BillingInterval }
  | { kind: "unknown" }

/**
 * Grant whatever a completed checkout session purchased. Idempotent — safe to
 * call from the webhook AND again from the return-URL verifier.
 */
export async function fulfillCheckoutSession(
  stripe: Stripe,
  session: any,
): Promise<FulfillmentResult> {
  const pool = getPostgresPool()
  const userId = session.metadata?.userId
  if (!userId) return { kind: "unknown" }

  // ── Immigration marketplace booking (Connect destination charge) ────
  if (session.metadata?.type === "immigration_service") {
    const requestId = session.metadata?.requestId
    if (requestId) {
      // Guarded by status='matched' — a second run is a no-op.
      await pool.query(
        `UPDATE immigration_service_requests
            SET status = 'scheduled',
                stripe_payment_intent_id = $1,
                amount_paid_cents = $2,
                paid_at = now(),
                updated_at = now()
          WHERE id = $3 AND user_id = $4 AND status = 'matched'`,
        [
          (session.payment_intent as string | null) ?? null,
          typeof session.amount_total === "number" ? session.amount_total : null,
          requestId,
          userId,
        ],
      )
      return { kind: "immigration_service", requestId }
    }
    return { kind: "unknown" }
  }

  // ── Live interview credit purchase ──────────────────────────────────
  if (session.metadata?.type === "live_interview_credits") {
    const credits = parseInt(session.metadata?.credits ?? "0", 10)
    if (credits > 0) {
      // Deduped on (payment_intent, reason) — a webhook retry or a verifier
      // re-run cannot double-grant.
      const { granted } = await grantCredits(userId, credits, "purchase", {
        stripePaymentIntentId: (session.payment_intent as string | undefined) ?? undefined,
      })
      return { kind: "live_interview_credits", credits, granted }
    }
    return { kind: "unknown" }
  }

  // ── Feature credit pack purchase ────────────────────────────────────
  if (session.metadata?.type === "feature_credit_pack") {
    const packKey = session.metadata?.pack
    if (isPackKey(packKey)) {
      const pack = FEATURE_PACKS[packKey]
      // grantPackCredits is ON CONFLICT (stripe_payment_intent_id) — idempotent.
      await grantPackCredits({
        userId,
        feature: pack.feature,
        packKey,
        credits: pack.credits,
        amountCents: pack.amountCents,
        stripePaymentIntentId: session.payment_intent as string | undefined,
      })
      return { kind: "feature_credit_pack", pack: packKey, credits: pack.credits }
    }
    return { kind: "unknown" }
  }

  // ── Subscription checkout ───────────────────────────────────────────
  const plan = session.metadata?.plan
  const interval = session.metadata?.interval ?? "monthly"
  if (!plan || (plan !== "pro" && plan !== "pro_max" && plan !== "pro_international")) {
    return { kind: "unknown" }
  }
  if (interval !== "monthly" && interval !== "yearly") return { kind: "unknown" }
  const planForPricing = normalizePlanForPricing(plan)
  if (planForPricing !== "pro" && planForPricing !== "pro_max") return { kind: "unknown" }

  const sub = await stripe.subscriptions.retrieve(session.subscription as string)
  const period = getSubscriptionPeriod(sub)
  const firstItem = (sub as any).items?.data?.[0]
  const amountCents =
    typeof firstItem?.price?.unit_amount === "number"
      ? firstItem.price.unit_amount
      : getPlanAmountCents(planForPricing, interval)

  await upsertSubscriptionRow(pool, {
    userId,
    plan: planForPricing,
    status: normalizeStripeSubscriptionStatus(sub.status),
    stripeSubscriptionId: sub.id,
    stripeCustomerId: session.customer as string,
    interval,
    amountCents,
    currentPeriodStart: new Date(period.start * 1000),
    currentPeriodEnd: new Date(period.end * 1000),
    trialEnd: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
    cancelAtPeriodEnd: Boolean((sub as any).cancel_at_period_end),
  })

  // Launch offer: a Pro Max sub bought with a credit-withholding promo (LAUNCH)
  // does NOT get the free live-interview credit during its first (discounted)
  // period. Hold it until the first renewal (current_period_end); credits.ts
  // reads this and skips the monthly grant while now < hold.
  const appliedCode = session.metadata?.promoCode
  const promoRule = appliedCode ? RESTRICTED_PROMO_CODES[appliedCode] : undefined
  if (promoRule?.withholdsInterviewCreditFirstPeriod && planForPricing === "pro_max") {
    await pool.query(
      `UPDATE subscriptions
          SET interview_credit_hold_until = $2, updated_at = now()
        WHERE stripe_subscription_id = $1
          AND interview_credit_hold_until IS NULL`,
      [sub.id, new Date(period.end * 1000)],
    )
  }
  return { kind: "subscription", plan: planForPricing, interval }
}

/**
 * Revoke what a refunded charge originally granted. Idempotent:
 * - interview credits: reversal ledger row deduped on (payment_intent, reason)
 * - feature packs: refunded_at guard, credits zeroed once
 * Subscription refunds are handled by Stripe cancelling the subscription
 * (customer.subscription.updated/deleted keeps the row in sync).
 */
export async function revokeForRefundedPaymentIntent(paymentIntentId: string): Promise<void> {
  if (!paymentIntentId) return
  const pool = getPostgresPool()

  // Interview credits: insert a negative reversal row and clamp the balance.
  await pool.query(
    `WITH purchase AS (
       SELECT user_id, amount FROM interview_credit_transactions
       WHERE stripe_payment_intent_id = $1 AND reason = 'purchase'
       LIMIT 1
     ),
     ins AS (
       INSERT INTO interview_credit_transactions
         (user_id, amount, reason, stripe_payment_intent_id)
       SELECT user_id, -amount, 'stripe_refund', $1 FROM purchase
       ON CONFLICT DO NOTHING
       RETURNING user_id, amount
     )
     UPDATE interview_credit_balances b
        SET balance = GREATEST(0, b.balance + ins.amount),
            updated_at = now()
       FROM ins
      WHERE b.user_id = ins.user_id`,
    [paymentIntentId],
  )

  // Feature packs: zero the remaining credits once.
  await pool.query(
    `UPDATE feature_credit_packs
        SET credits_remaining = 0,
            refunded_at = now()
      WHERE stripe_payment_intent_id = $1
        AND refunded_at IS NULL`,
    [paymentIntentId],
  )
}
