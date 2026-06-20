import { NextRequest, NextResponse } from "next/server"
import type { Pool } from "pg"
import { getPlanAmountCents, type BillingInterval, type PlanKey } from "@/lib/pricing"
import { getPostgresPool } from "@/lib/postgres/server"

export const runtime = "nodejs"

type StoredSubscriptionStatus = "active" | "trialing" | "canceled" | "past_due" | "unpaid"

function normalizePlanForPricing(raw: string | null | undefined): PlanKey {
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

function normalizeStripeSubscriptionStatus(raw: string | null | undefined): StoredSubscriptionStatus {
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

async function upsertSubscriptionRow(
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

export async function POST(request: NextRequest) {
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 503 })
  }

  const Stripe = (await import("stripe")).default
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2026-03-25.dahlia" })

  const body = await request.text()
  const sig = request.headers.get("stripe-signature") ?? ""

  let event: ReturnType<typeof stripe.webhooks.constructEvent>
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET)
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 })
  }

  const pool = getPostgresPool()

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as any
      const userId = session.metadata?.userId
      if (!userId) break

      // ── Immigration marketplace booking (Connect destination charge) ────
      if (session.metadata?.type === "immigration_service") {
        const requestId = session.metadata?.requestId
        if (requestId) {
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
        }
        break
      }

      // ── Live interview credit purchase ──────────────────────────────────
      if (session.metadata?.type === "live_interview_credits") {
        const credits = parseInt(session.metadata?.credits ?? "0", 10)
        if (credits > 0) {
          const { grantCredits } = await import("@/lib/apex/interview/credits")
          await grantCredits(
            userId,
            credits,
            "purchase",
            session.payment_intent as string | undefined
          )
        }
        break
      }

      // ── Feature credit pack purchase ────────────────────────────────────
      if (session.metadata?.type === "feature_credit_pack") {
        const { isPackKey, FEATURE_PACKS } = await import("@/lib/billing/packs")
        const { grantPackCredits } = await import("@/lib/billing/packs-server")
        const packKey = session.metadata?.pack
        if (isPackKey(packKey)) {
          const pack = FEATURE_PACKS[packKey]
          await grantPackCredits({
            userId,
            feature: pack.feature,
            packKey,
            credits: pack.credits,
            amountCents: pack.amountCents,
            stripePaymentIntentId: session.payment_intent as string | undefined,
          })
        }
        break
      }

      // ── Subscription checkout ───────────────────────────────────────────
      const plan = session.metadata?.plan
      const interval = session.metadata?.interval ?? "monthly"
      if (!plan || (plan !== 'pro' && plan !== 'pro_max' && plan !== 'pro_international')) break
      if (interval !== "monthly" && interval !== "yearly") break
      const planForPricing = normalizePlanForPricing(plan)
      if (planForPricing !== "pro" && planForPricing !== "pro_max") break

      const sub = await stripe.subscriptions.retrieve(session.subscription as string)
      const period = getSubscriptionPeriod(sub)
      const firstItem = sub.items?.data?.[0]
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
        cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
      })
      break
    }

    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object as any
      const userId = sub.metadata?.userId
      if (!userId) break

      const plan = normalizePlanForPricing(sub.metadata?.plan ?? "free")
      const recurringInterval = sub.items?.data?.[0]?.price?.recurring?.interval
      const interval: BillingInterval =
        sub.metadata?.interval === "yearly" || recurringInterval === "year"
          ? "yearly"
          : "monthly"
      const amountCents =
        typeof sub.items?.data?.[0]?.price?.unit_amount === "number"
          ? sub.items.data[0].price.unit_amount
          : plan === "free"
            ? 0
            : getPlanAmountCents(plan, interval)
      const period = getSubscriptionPeriod(sub)

      await upsertSubscriptionRow(pool, {
        userId,
        plan,
        status: normalizeStripeSubscriptionStatus(sub.status),
        stripeSubscriptionId: sub.id,
        stripeCustomerId: sub.customer as string,
        interval,
        amountCents,
        currentPeriodStart: new Date(period.start * 1000),
        currentPeriodEnd: new Date(period.end * 1000),
        trialEnd: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
        cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
      })
      break
    }
  }

  return NextResponse.json({ received: true })
}
