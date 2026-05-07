import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { getUserPlan } from "@/lib/gates/server-gate"

export const runtime = "nodejs"

// Session-slot packs: 1 credit = 1 session (any duration ≤ stated max)
const PACKS = {
  session_short_1: { credits: 1, amountCents: 1200, label: "1 session — up to 30 min" },
  session_long_1:  { credits: 1, amountCents: 2000, label: "1 session — up to 60 min" },
  session_short_3: { credits: 3, amountCents: 3000, label: "3 sessions — up to 30 min each" },
  session_short_5: { credits: 5, amountCents: 4500, label: "5 sessions — up to 30 min each" },
} as const

type PackKey = keyof typeof PACKS

export async function POST(request: Request) {
  const { userId, plan } = await getUserPlan()
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (plan !== "pro_max") {
    return NextResponse.json({ error: "Live interview credits require Pro Max" }, { status: 403 })
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 503 })
  }

  const body = await request.json().catch(() => ({})) as { pack?: string }
  const packKey = body.pack as PackKey | undefined
  const pack = packKey ? PACKS[packKey] : null
  if (!pack) {
    return NextResponse.json(
      { error: `Invalid pack. Choose one of: ${Object.keys(PACKS).join(", ")}` },
      { status: 400 }
    )
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const pool = getPostgresPool()
  const Stripe = (await import("stripe")).default
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2026-03-25.dahlia" })

  // Reuse existing Stripe customer if available
  const subResult = await pool.query<{ stripe_customer_id: string | null }>(
    `SELECT stripe_customer_id FROM subscriptions
     WHERE user_id = $1
     ORDER BY created_at DESC LIMIT 1`,
    [userId]
  )
  let customerId = subResult.rows[0]?.stripe_customer_id as string | undefined

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

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"

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
          name: `Hireoven Live Interview Credits`,
          description: pack.label,
          metadata: { credits: String(pack.credits) },
        },
      },
    }],
    metadata: {
      userId,
      type: "live_interview_credits",
      credits: String(pack.credits),
      pack: packKey!,
    },
    success_url: `${appUrl}/dashboard/interview?credits=purchased&amount=${pack.credits}`,
    cancel_url:  `${appUrl}/dashboard/interview`,
  })

  return NextResponse.json({ url: session.url, credits: pack.credits, amountCents: pack.amountCents })
}
