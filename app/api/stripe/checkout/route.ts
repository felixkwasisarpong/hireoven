import { NextResponse } from "next/server"
import { resolveAppOrigin } from "@/lib/app-url"
import { isPaymentsDisabled } from "@/lib/admin/feature-flags"
import { getPlanAmountCents, RESTRICTED_PROMO_CODES, STUDENT_DISCOUNT_ENABLED, type BillingInterval, type PlanKey } from "@/lib/pricing"
import { getPostgresPool } from "@/lib/postgres/server"
import { createClient } from "@/lib/supabase/server"

export const runtime = "nodejs"

const PRICE_IDS: Record<string, Record<string, string | undefined>> = {
  pro: {
    monthly: process.env.STRIPE_PRICE_PRO_MONTHLY,
    yearly: process.env.STRIPE_PRICE_PRO_YEARLY,
  },
  pro_max: {
    monthly: process.env.STRIPE_PRICE_PRO_MAX_MONTHLY,
    yearly: process.env.STRIPE_PRICE_PRO_MAX_YEARLY,
  },
}

export async function POST(request: Request) {
  if (await isPaymentsDisabled()) {
    return NextResponse.json(
      { error: "Payments are temporarily paused. Please check back soon." },
      { status: 503 },
    )
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const pool = getPostgresPool()

  const body = await request.json().catch(() => ({})) as {
    plan?: string
    interval?: string
    promoCode?: string
  }
  const { plan = "pro", interval = "monthly" } = body
  const promoCodeRaw = typeof body.promoCode === "string" ? body.promoCode.trim() : ""

  if (
    (plan !== 'pro' && plan !== 'pro_max') ||
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

  // Resolve the promo code (if any) to a Stripe promotion_code ID we can attach.
  // Invalid/expired codes return a 400 so the client surfaces the error before
  // redirecting; manual entry via Stripe Checkout still works as a fallback.
  let promotionCodeId: string | null = null
  let appliedPromoCode: string | null = null
  if (promoCodeRaw) {
    const code = promoCodeRaw.toUpperCase()
    // Plan/interval-restricted codes (e.g. LAUNCH = Pro Max monthly only). Stripe
    // coupons can't scope to a single price here, so enforce it before attaching.
    const restriction = RESTRICTED_PROMO_CODES[code]
    if (
      restriction &&
      (!restriction.plans.some((p) => p === plan) ||
        !restriction.intervals.some((i) => i === interval))
    ) {
      return NextResponse.json(
        { error: restriction.message, code: "PROMO_PLAN_MISMATCH" },
        { status: 400 }
      )
    }
    const promoLookup = await stripe.promotionCodes.list({
      code,
      active: true,
      limit: 1,
      expand: ["data.promotion.coupon"],
    })
    const promo = promoLookup.data[0]
    const coupon = promo && typeof promo.promotion.coupon === "object" ? promo.promotion.coupon : null
    if (!promo || !coupon || !coupon.valid) {
      return NextResponse.json(
        { error: "That promo code isn't valid.", code: "PROMO_INVALID" },
        { status: 400 }
      )
    }
    const expiresAt = typeof promo.expires_at === "number" ? promo.expires_at * 1000 : null
    if (expiresAt && expiresAt < Date.now()) {
      return NextResponse.json(
        { error: "That promo code has expired.", code: "PROMO_EXPIRED" },
        { status: 400 }
      )
    }
    if (typeof promo.max_redemptions === "number" && promo.times_redeemed >= promo.max_redemptions) {
      return NextResponse.json(
        { error: "That promo code has been fully redeemed.", code: "PROMO_EXHAUSTED" },
        { status: 400 }
      )
    }
    promotionCodeId = promo.id
    appliedPromoCode = code
  }

  // Student auto-discount: if the user has a verified .edu email AND no
  // user-supplied promo code already won, attach the configured student
  // promotion code. STRIPE_STUDENT_PROMOTION_CODE_ID is set in env after the
  // promotion code is created in the Stripe dashboard.
  // Gated by STUDENT_DISCOUNT_ENABLED — disabled for launch, but the code path
  // is preserved so it can be flipped back on without a rewrite.
  if (STUDENT_DISCOUNT_ENABLED && !promotionCodeId && process.env.STRIPE_STUDENT_PROMOTION_CODE_ID) {
    const studentRow = await pool.query<{ is_student: boolean }>(
      `SELECT is_student FROM profiles WHERE id = $1`,
      [user.id]
    )
    if (studentRow.rows[0]?.is_student) {
      promotionCodeId = process.env.STRIPE_STUDENT_PROMOTION_CODE_ID
    }
  }

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

  // Only trust customer IDs that look like real Stripe customers (cus_*).
  // Legacy seed/test rows used "manual_<uuid>" placeholders that Stripe
  // rightfully rejects; treat those as missing so we create a real customer.
  const rawCustomerId = existingSub?.stripe_customer_id as string | null | undefined
  let customerId =
    typeof rawCustomerId === "string" && rawCustomerId.startsWith("cus_")
      ? rawCustomerId
      : undefined

  if (!customerId) {
    const customer = await stripe.customers.create({
      email: profile?.email ?? user.email ?? undefined,
      name: profile?.full_name ?? undefined,
      metadata: { userId: user.id },
    })
    customerId = customer.id
  }

  const appUrl = resolveAppOrigin(request)

  const sessionParams: import("stripe").default.Checkout.SessionCreateParams = {
    customer: customerId,
    mode: "subscription",
    payment_method_collection: "if_required",
    payment_method_types: ["card"],
    line_items: [{ price: priceId, quantity: 1 }],
    subscription_data: {
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
      ...(promotionCodeId ? { promotionCodeId } : {}),
      ...(appliedPromoCode ? { promoCode: appliedPromoCode } : {}),
    },
  }

  // If a code was passed and validated, pre-apply it. Otherwise let the user
  // type one in Stripe's Checkout UI (mutually exclusive with `discounts`).
  if (promotionCodeId) {
    sessionParams.discounts = [{ promotion_code: promotionCodeId }]
  } else {
    sessionParams.allow_promotion_codes = true
  }

  try {
    const session = await stripe.checkout.sessions.create(sessionParams)
    if (!session.url) {
      return NextResponse.json(
        { error: "Stripe didn't return a checkout URL. Try again." },
        { status: 502 }
      )
    }
    return NextResponse.json({ url: session.url })
  } catch (err) {
    // Stripe SDK throws on bad price IDs, expired promotion codes, customer
    // mismatches, etc. Surface a JSON error instead of letting Next.js render
    // a 500 HTML page that the client can't parse.
    const message = err instanceof Error ? err.message : "Unknown Stripe error"
    console.error("[stripe/checkout] session create failed:", err)
    return NextResponse.json(
      { error: `Couldn't start checkout: ${message}`, code: "STRIPE_SESSION_FAILED" },
      { status: 502 }
    )
  }
}
