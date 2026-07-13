import { NextRequest, NextResponse } from "next/server"
import { getPlanAmountCents, type BillingInterval } from "@/lib/pricing"
import { getPostgresPool } from "@/lib/postgres/server"
import {
  fulfillCheckoutSession,
  normalizePlanForPricing,
  normalizeStripeSubscriptionStatus,
  revokeForRefundedPaymentIntent,
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
