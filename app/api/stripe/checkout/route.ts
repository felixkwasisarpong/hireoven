import { NextResponse } from "next/server"
import { getPlanAmountCents, type BillingInterval, type PlanKey } from "@/lib/pricing"
import { getPostgresPool } from "@/lib/postgres/server"
import { createClient } from "@/lib/supabase/server"

export const runtime = "nodejs"

const PRICE_IDS: Record<string, Record<string, string | undefined>> = {
  pro: {
    monthly: process.env.STRIPE_PRICE_PRO_MONTHLY,
    yearly: process.env.STRIPE_PRICE_PRO_YEARLY,
  },
  pro_international: {
    monthly: process.env.STRIPE_PRICE_INTL_MONTHLY,
    yearly: process.env.STRIPE_PRICE_INTL_YEARLY,
  },
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const pool = getPostgresPool()

  const body = await request.json().catch(() => ({})) as { plan?: string; interval?: string }
  const { plan = "pro", interval = "monthly" } = body

  if (
    (plan !== "pro" && plan !== "pro_international") ||
    (interval !== "monthly" && interval !== "yearly")
  ) {
    return NextResponse.json({ error: "Invalid plan or interval" }, { status: 400 })
  }

  const priceId = PRICE_IDS[plan]?.[interval]
  if (!priceId) {
    return NextResponse.json({ error: "Invalid plan or interval" }, { status: 400 })
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 503 })
  }

  const Stripe = (await import("stripe")).default
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2026-03-25.dahlia" })

  const [profileResult, existingSubResult] = await Promise.all([
    pool.query<{ email: string | null; full_name: string | null }>(
      `SELECT email, full_name
       FROM profiles
       WHERE id = $1
       LIMIT 1`,
      [user.id]
    ),
    pool.query<{ stripe_customer_id: string | null }>(
      `SELECT stripe_customer_id
       FROM subscriptions
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [user.id]
    ),
  ])
  const profile = profileResult.rows[0]
  const existingSub = existingSubResult.rows[0]

  let customerId = existingSub?.stripe_customer_id as string | undefined

  if (!customerId) {
    const customer = await stripe.customers.create({
      email: profile?.email ?? user.email ?? undefined,
      name: profile?.full_name ?? undefined,
      metadata: { userId: user.id },
    })
    customerId = customer.id
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    payment_method_collection: "if_required",
    payment_method_types: ["card"],
    line_items: [{ price: priceId, quantity: 1 }],
    subscription_data: {
      trial_period_days: 7,
      metadata: {
        userId: user.id,
        plan,
        interval,
        amountCents: String(getPlanAmountCents(plan as PlanKey, interval as BillingInterval)),
      },
    },
    success_url: `${appUrl}/dashboard?upgrade=success&plan=${plan}`,
    cancel_url: `${appUrl}/dashboard/upgrade`,
    metadata: {
      userId: user.id,
      plan,
      interval,
      amountCents: String(getPlanAmountCents(plan as PlanKey, interval as BillingInterval)),
    },
  })

  return NextResponse.json({ url: session.url })
}
