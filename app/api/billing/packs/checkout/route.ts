import { NextResponse } from "next/server"
import { resolveAppOrigin } from "@/lib/app-url"
import { isPaymentsDisabled } from "@/lib/admin/feature-flags"
import { getUserPlan } from "@/lib/gates/server-gate"
import { getPostgresPool } from "@/lib/postgres/server"
import { createClient } from "@/lib/supabase/server"
import { FEATURE_PACKS, isPackKey } from "@/lib/billing/packs"

export const runtime = "nodejs"

export async function POST(request: Request) {
  if (await isPaymentsDisabled()) {
    return NextResponse.json(
      { error: "Payments are temporarily paused. Please check back soon." },
      { status: 503 },
    )
  }

  const { userId } = await getUserPlan()
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 503 })
  }

  const body = await request.json().catch(() => ({})) as { pack?: string; returnUrl?: string }
  if (!isPackKey(body.pack)) {
    return NextResponse.json(
      { error: `Invalid pack. Choose one of: ${Object.keys(FEATURE_PACKS).join(", ")}` },
      { status: 400 }
    )
  }

  const pack = FEATURE_PACKS[body.pack]

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const pool = getPostgresPool()
  const Stripe = (await import("stripe")).default
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2026-03-25.dahlia" })

  const subResult = await pool.query<{ stripe_customer_id: string | null }>(
    `SELECT stripe_customer_id FROM subscriptions
     WHERE user_id = $1
     ORDER BY created_at DESC LIMIT 1`,
    [userId]
  )
  const rawCustomerId = subResult.rows[0]?.stripe_customer_id as string | null | undefined
  let customerId =
    typeof rawCustomerId === "string" && rawCustomerId.startsWith("cus_")
      ? rawCustomerId
      : undefined

  if (!customerId) {
    const profileResult = await pool.query<{ email: string | null; full_name: string | null }>(
      `SELECT email, full_name FROM profiles WHERE id = $1`,
      [userId]
    )
    const prof = profileResult.rows[0]
    const customer = await stripe.customers.create({
      email: prof?.email ?? user.email ?? undefined,
      name: prof?.full_name ?? undefined,
      metadata: { userId },
    })
    customerId = customer.id
  }

  const appUrl = resolveAppOrigin(request)
  const returnUrl = typeof body.returnUrl === "string" && body.returnUrl.startsWith("/")
    ? body.returnUrl
    : "/dashboard/billing"

  try {
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [{
        quantity: 1,
        price_data: {
          currency: process.env.STRIPE_CURRENCY ?? "usd",
          unit_amount: pack.amountCents,
          product_data: {
            name: pack.label,
            description: pack.description,
            metadata: {
              feature: pack.feature,
              credits: String(pack.credits),
            },
          },
        },
      }],
      metadata: {
        userId,
        type: "feature_credit_pack",
        pack: body.pack,
        feature: pack.feature,
        credits: String(pack.credits),
        amountCents: String(pack.amountCents),
      },
      success_url: `${appUrl}${returnUrl}?pack=purchased&feature=${pack.feature}&credits=${pack.credits}`,
      cancel_url: `${appUrl}${returnUrl}`,
    })

    return NextResponse.json({
      url: session.url,
      pack: body.pack,
      credits: pack.credits,
      amountCents: pack.amountCents,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown Stripe error"
    console.error("[billing/packs/checkout] session create failed:", err)
    return NextResponse.json(
      { error: `Couldn't start checkout: ${message}`, code: "STRIPE_SESSION_FAILED" },
      { status: 502 }
    )
  }
}
