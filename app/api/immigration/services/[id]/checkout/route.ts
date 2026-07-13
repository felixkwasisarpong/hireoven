/**
 * POST /api/immigration/services/[id]/checkout
 *
 * Pay for a matched service request. Creates a Stripe Connect destination
 * charge: the user pays the quoted price, the matched partner nets the balance,
 * and Hireoven keeps its take-rate as the application fee. Returns the Checkout
 * URL. The webhook records payment + advances the request to "scheduled".
 */
import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { resolveAppOrigin } from "@/lib/app-url"
import { isPaymentsDisabled } from "@/lib/admin/feature-flags"
import { buildServiceCheckoutParams } from "@/lib/immigration/connect"
import { getOffering } from "@/lib/immigration/services"

export const runtime = "nodejs"

type RequestRow = {
  id: string
  offering_id: string
  status: string
  quoted_price: number
  platform_fee: number
  contact_email: string | null
  partner_id: string | null
  partner_account: string | null
  partner_active: boolean | null
  partner_onboarded: boolean | null
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  if (await isPaymentsDisabled()) return NextResponse.json({ error: "Payments are disabled" }, { status: 503 })
  if (!process.env.STRIPE_SECRET_KEY) return NextResponse.json({ error: "Stripe not configured" }, { status: 503 })

  const pool = getPostgresPool()
  const { rows } = await pool.query<RequestRow>(
    `SELECT r.id, r.offering_id, r.status, r.quoted_price, r.platform_fee, r.contact_email,
            r.partner_id, p.stripe_account_id AS partner_account,
            p.active AS partner_active, p.onboarding_complete AS partner_onboarded
       FROM immigration_service_requests r
       LEFT JOIN service_partners p ON p.id = r.partner_id
      WHERE r.id = $1 AND r.user_id = $2 LIMIT 1`,
    [params.id, user.id],
  )
  const req = rows[0]
  if (!req) return NextResponse.json({ error: "Request not found" }, { status: 404 })

  if (req.status === "scheduled" || req.status === "completed") {
    return NextResponse.json({ error: "This request is already paid" }, { status: 409 })
  }
  if (req.status !== "matched") {
    return NextResponse.json({ error: "Request isn't matched with a partner yet" }, { status: 409 })
  }
  if (!req.partner_id || !req.partner_account || !req.partner_active || !req.partner_onboarded) {
    return NextResponse.json({ error: "Matched partner isn't ready to receive payments" }, { status: 409 })
  }

  const offering = getOffering(req.offering_id)
  const offeringName = offering?.name ?? "Immigration service"

  const Stripe = (await import("stripe")).default
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2026-03-25.dahlia" })

  const origin = resolveAppOrigin(request)
  const sessionParams = buildServiceCheckoutParams({
    quote: { price: Number(req.quoted_price), platformFee: Number(req.platform_fee) },
    offeringName,
    partnerStripeAccountId: req.partner_account,
    requestId: req.id,
    userId: user.id,
    customerEmail: req.contact_email ?? user.email ?? null,
    successUrl: `${origin}/dashboard/international/services?paid=${req.id}&session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${origin}/dashboard/international/services?canceled=${req.id}`,
  })

  try {
    const session = await stripe.checkout.sessions.create(
      sessionParams as Parameters<typeof stripe.checkout.sessions.create>[0],
    )
    if (!session.url) return NextResponse.json({ error: "Stripe returned no checkout URL" }, { status: 502 })

    await pool.query(
      `UPDATE immigration_service_requests SET stripe_checkout_session_id = $1, updated_at = now() WHERE id = $2`,
      [session.id, req.id],
    )
    return NextResponse.json({ url: session.url })
  } catch (err) {
    console.error("[immigration/checkout] session create failed:", err)
    return NextResponse.json({ error: "Could not start checkout" }, { status: 500 })
  }
}
