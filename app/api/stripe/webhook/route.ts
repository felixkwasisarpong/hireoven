import { NextRequest, NextResponse } from "next/server"
import { getPlanAmountCents, type BillingInterval, type PlanKey } from "@/lib/pricing"
import { getPostgresPool } from "@/lib/postgres/server"
import { startTrial } from "@/lib/stripe/trial"

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
      const session = event.data.object as any
      const userId = session.metadata?.userId
      const plan = session.metadata?.plan
      const interval = session.metadata?.interval ?? "monthly"
      if (!userId || (plan !== "pro" && plan !== "pro_international")) break
      if (interval !== "monthly" && interval !== "yearly") break

      const sub = await stripe.subscriptions.retrieve(session.subscription as string)
      const period = getSubscriptionPeriod(sub)
      const trialEnd = sub.trial_end
        ? new Date(sub.trial_end * 1000)
        : new Date(period.end * 1000)

      await startTrial(userId, plan, interval, trialEnd, sub.id, session.customer as string)
      break
    }

    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object as any
      const userId = sub.metadata?.userId
      if (!userId) break

      const statusMap: Record<string, string> = {
        active: "active",
        trialing: "trialing",
        canceled: "canceled",
        past_due: "past_due",
        unpaid: "unpaid",
      }
      const plan = (sub.metadata?.plan ?? "free") as PlanKey
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
          userId,
          plan,
          statusMap[sub.status] ?? "canceled",
          sub.id,
          sub.customer as string,
          interval,
          amountCents,
          new Date(period.start * 1000).toISOString(),
          new Date(period.end * 1000).toISOString(),
          sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
          sub.cancel_at_period_end,
          new Date().toISOString(),
        ]
      )
      break
    }
  }

  return NextResponse.json({ received: true })
}
