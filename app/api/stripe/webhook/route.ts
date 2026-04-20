import { NextRequest, NextResponse } from "next/server"
import { getPlanAmountCents, type BillingInterval, type PlanKey } from "@/lib/pricing"
import { startTrial } from "@/lib/stripe/trial"
import { createAdminClient } from "@/lib/supabase/admin"

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

  const supabase = createAdminClient()

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

      await supabase.from("subscriptions" as any).upsert(
        {
          user_id: userId,
          plan,
          status: statusMap[sub.status] ?? "canceled",
          stripe_subscription_id: sub.id,
          stripe_customer_id: sub.customer as string,
          billing_interval: interval,
          amount_cents: amountCents,
          current_period_start: new Date(period.start * 1000).toISOString(),
          current_period_end: new Date(period.end * 1000).toISOString(),
          trial_end: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
          cancel_at_period_end: sub.cancel_at_period_end,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "stripe_subscription_id" }
      )
      break
    }
  }

  return NextResponse.json({ received: true })
}
