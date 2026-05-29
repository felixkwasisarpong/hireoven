import { NextResponse } from "next/server"
import { getUserPlan } from "@/lib/gates/server-gate"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type PromoPreview = {
  code: string
  promotionCodeId: string
  couponId: string
  percentOff: number | null
  amountOff: number | null
  currency: string | null
  duration: string
  durationInMonths: number | null
  appliesToProductIds: string[]
  /** Human-readable summary, safe to render in UI. */
  label: string
}

function buildPreviewLabel(args: {
  percentOff: number | null
  amountOff: number | null
  currency: string | null
  duration: string
  durationInMonths: number | null
}): string {
  const { percentOff, amountOff, currency, duration, durationInMonths } = args
  const head = percentOff != null
    ? `${percentOff}% off`
    : amountOff != null
      ? `${new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: (currency ?? "USD").toUpperCase(),
          minimumFractionDigits: 0,
        }).format(amountOff / 100)} off`
      : "Discount"

  const tail = duration === "forever"
    ? "for the life of your subscription"
    : duration === "once"
      ? "on your first invoice"
      : duration === "repeating" && durationInMonths
        ? `for the first ${durationInMonths} month${durationInMonths === 1 ? "" : "s"}`
        : ""

  return tail ? `${head} ${tail}.` : `${head}.`
}

export async function POST(request: Request) {
  const { userId } = await getUserPlan()
  if (!userId) return NextResponse.json({ error: "Authentication required" }, { status: 401 })

  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 503 })
  }

  const body = await request.json().catch(() => ({})) as { code?: string }
  const raw = typeof body.code === "string" ? body.code.trim() : ""
  if (!raw) return NextResponse.json({ error: "Promo code is required" }, { status: 400 })
  // Stripe promotion codes are case-insensitive on the dashboard but the API
  // requires exact match. Most teams configure codes in uppercase.
  const code = raw.toUpperCase()

  const Stripe = (await import("stripe")).default
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2026-03-25.dahlia" })

  // Stripe doesn't have a "get-by-code" lookup, so list active codes filtered
  // by the `code` parameter. There's at most one active promotion code per
  // string per account (Stripe enforces uniqueness).
  const result = await stripe.promotionCodes.list({
    code,
    active: true,
    limit: 1,
    expand: ["data.promotion.coupon"],
  })
  const promo = result.data[0]

  if (!promo) {
    return NextResponse.json(
      { error: "That promo code isn't valid or has expired.", code: "PROMO_NOT_FOUND" },
      { status: 404 }
    )
  }

  const expiresAt = typeof promo.expires_at === "number"
    ? promo.expires_at * 1000
    : null
  if (expiresAt && expiresAt < Date.now()) {
    return NextResponse.json(
      { error: "That promo code has expired.", code: "PROMO_EXPIRED" },
      { status: 410 }
    )
  }
  if (typeof promo.max_redemptions === "number" && promo.times_redeemed >= promo.max_redemptions) {
    return NextResponse.json(
      { error: "That promo code has been fully redeemed.", code: "PROMO_EXHAUSTED" },
      { status: 410 }
    )
  }

  const coupon = typeof promo.promotion.coupon === "object" ? promo.promotion.coupon : null
  if (!coupon || !coupon.valid) {
    return NextResponse.json(
      { error: "That promo code is no longer valid.", code: "PROMO_INVALID" },
      { status: 410 }
    )
  }

  const preview: PromoPreview = {
    code: promo.code,
    promotionCodeId: promo.id,
    couponId: coupon.id,
    percentOff: coupon.percent_off ?? null,
    amountOff: coupon.amount_off ?? null,
    currency: coupon.currency ?? null,
    duration: coupon.duration,
    durationInMonths: coupon.duration_in_months ?? null,
    appliesToProductIds: coupon.applies_to?.products ?? [],
    label: buildPreviewLabel({
      percentOff: coupon.percent_off ?? null,
      amountOff: coupon.amount_off ?? null,
      currency: coupon.currency ?? null,
      duration: coupon.duration,
      durationInMonths: coupon.duration_in_months ?? null,
    }),
  }

  return NextResponse.json(preview)
}
