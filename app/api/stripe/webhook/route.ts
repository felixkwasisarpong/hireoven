import { NextRequest, NextResponse } from "next/server"
import { getPlanAmountCents, type BillingInterval } from "@/lib/pricing"
import { getPostgresPool } from "@/lib/postgres/server"
import {
  fulfillCheckoutSession,
  normalizePlanForPricing,
  normalizeStripeSubscriptionStatus,
  resolveSubscriptionUserId,
  revokeForRefundedPaymentIntent,
  subscriptionIdFromInvoice,
  upsertSubscriptionRow,
} from "@/lib/billing/fulfillment"

export const runtime = "nodejs"

function getSubscriptionPeriod(sub: any) {
  const firstItem = sub.items?.data?.[0]
  return {
    start: sub.current_period_start ?? firstItem?.current_period_start ?? sub.start_date ?? sub.created,
    end: sub.current_period_end ?? firstItem?.current_period_end ?? sub.trial_end ?? sub.cancel_at ?? sub.ended_at ?? sub.created,
  }
}

/**
 * The plan a price sells, for a subscription that carries no metadata of ours
 * — one created in the Stripe dashboard, say. Without this such a subscription
 * would be filed as "free" and quietly strip a paying customer of their plan.
 */
function planFromPriceId(priceId: string | null | undefined): string | null {
  if (!priceId) return null
  if (priceId === process.env.STRIPE_PRICE_PRO_MONTHLY || priceId === process.env.STRIPE_PRICE_PRO_YEARLY) return "pro"
  if (priceId === process.env.STRIPE_PRICE_PRO_MAX_MONTHLY || priceId === process.env.STRIPE_PRICE_PRO_MAX_YEARLY) return "pro_max"
  return null
}

/**
 * Write what Stripe now says about a subscription into our own ledger.
 *
 * Reached from the subscription events and from the invoice ones, because a
 * renewal that only ever announced itself through a single event type is a
 * renewal that goes missing the day that event isn't delivered.
 */
async function recordSubscription(pool: ReturnType<typeof getPostgresPool>, sub: any): Promise<void> {
  const userId = await resolveSubscriptionUserId(pool, sub)
  if (!userId) return

  const plan = normalizePlanForPricing(sub.metadata?.plan ?? planFromPriceId(sub.items?.data?.[0]?.price?.id) ?? "free")
  const recurringInterval = sub.items?.data?.[0]?.price?.recurring?.interval
  const interval: BillingInterval =
    sub.metadata?.interval === "yearly" || recurringInterval === "year" ? "yearly" : "monthly"
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
    stripeCustomerId: typeof sub.customer === "string" ? sub.customer : sub.customer?.id,
    interval,
    amountCents,
    currentPeriodStart: new Date(period.start * 1000),
    currentPeriodEnd: new Date(period.end * 1000),
    trialEnd: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
    cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
  })

  // The free monthly interview credit is a Pro Max perk. If this event leaves
  // the user without an active Pro Max plan (cancel/downgrade), claw back this
  // period's UNUSED grant — otherwise a 10-minute test subscription walks away
  // with a free live session. Purchased credits are untouched; already-spent
  // grants are left alone.
  const { getPlanForUserId } = await import("@/lib/gates/server-gate")
  const planAfter = await getPlanForUserId(userId)
  if (planAfter !== "pro_max") {
    const { clawbackUnusedMonthlyGrant } = await import("@/lib/apex/interview/credits")
    await clawbackUnusedMonthlyGrant(userId)
  }
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
      // Shared with /api/stripe/verify-session (return-URL fallback) — every
      // branch inside is idempotent, so double delivery is safe.
      await fulfillCheckoutSession(stripe, event.data.object as any)
      break
    }

    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      await recordSubscription(pool, event.data.object as any)
      break
    }

    // A renewal is money moving, and until now it reached the ledger only by
    // way of customer.subscription.updated. If that one event is missed — not
    // enabled on the endpoint, or dropped — the charge succeeds and the app
    // never hears, so the paid invoice records the new period as well. Both
    // paths write the same row, so either alone is enough.
    case "invoice.paid":
    case "invoice.payment_succeeded":
    case "invoice.payment_failed": {
      const subscriptionId = subscriptionIdFromInvoice(event.data.object as any)
      if (!subscriptionId) break
      const sub = await stripe.subscriptions.retrieve(subscriptionId)
      await recordSubscription(pool, sub as any)
      break
    }

    case "charge.refunded": {
      // A refund issued from the Stripe dashboard must revoke what the charge
      // granted (interview credits / feature packs) — otherwise the user keeps
      // the credits after getting their money back. Subscription refunds are
      // handled by the subscription.updated/deleted events above.
      const charge = event.data.object as any
      const paymentIntentId =
        typeof charge.payment_intent === "string"
          ? charge.payment_intent
          : charge.payment_intent?.id
      if (paymentIntentId) await revokeForRefundedPaymentIntent(paymentIntentId)
      break
    }
  }

  return NextResponse.json({ received: true })
}
