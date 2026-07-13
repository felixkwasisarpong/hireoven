import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { fulfillCheckoutSession } from "@/lib/billing/fulfillment"

export const runtime = "nodejs"

// POST { sessionId } — return-URL fulfillment fallback.
//
// The webhook is the primary fulfillment path, but if it fails or lags
// (Stripe retries for up to 3 days), the user lands on the success page with
// nothing granted. Checkout success URLs carry {CHECKOUT_SESSION_ID}; the
// client posts it here and we re-run the SAME idempotent fulfillment, so
// "paid but not received" can't happen while the app is reachable.
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 503 })
  }

  const body = await request.json().catch(() => ({})) as { sessionId?: string }
  const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : ""
  if (!/^cs_[a-zA-Z0-9_]+$/.test(sessionId)) {
    return NextResponse.json({ error: "Invalid sessionId" }, { status: 400 })
  }

  const Stripe = (await import("stripe")).default
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2026-03-25.dahlia" })

  let session
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId)
  } catch {
    return NextResponse.json({ error: "Session not found" }, { status: 404 })
  }

  // Only the buyer may trigger fulfillment for their own session.
  if (session.metadata?.userId !== user.id) {
    return NextResponse.json({ error: "Session does not belong to you" }, { status: 403 })
  }
  if (session.payment_status !== "paid" && session.payment_status !== "no_payment_required") {
    return NextResponse.json({ ok: false, status: session.payment_status })
  }

  try {
    const result = await fulfillCheckoutSession(stripe, session)
    return NextResponse.json({ ok: true, fulfilled: result })
  } catch (err) {
    console.error("[verify-session] fulfillment failed:", err)
    return NextResponse.json({ error: "Fulfillment failed — it will retry via webhook" }, { status: 500 })
  }
}
