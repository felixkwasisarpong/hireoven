/**
 * POST /api/immigration/partners/onboard
 *
 * Ops action (admin only): start or resume Stripe Connect onboarding for a
 * vetted immigration partner. Creates an Express connected account if the
 * partner doesn't have one, then returns a Stripe-hosted onboarding link to
 * send them. Their payouts route through this account once complete.
 *
 * Body: { partnerId: string }
 */
import { NextResponse } from "next/server"
import { assertAdminAccess } from "@/lib/admin/auth"
import { getPostgresPool } from "@/lib/postgres/server"
import { resolveAppOrigin } from "@/lib/app-url"
import { isPaymentsDisabled } from "@/lib/admin/feature-flags"

export const runtime = "nodejs"

type PartnerRow = {
  id: string
  name: string
  contact_email: string | null
  stripe_account_id: string | null
}

export async function POST(request: Request) {
  const admin = await assertAdminAccess()
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status })

  if (await isPaymentsDisabled()) {
    return NextResponse.json({ error: "Payments are disabled" }, { status: 503 })
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 503 })
  }

  const body = (await request.json().catch(() => ({}))) as { partnerId?: string }
  if (!body.partnerId) return NextResponse.json({ error: "partnerId required" }, { status: 400 })

  const pool = getPostgresPool()
  const { rows } = await pool.query<PartnerRow>(
    `SELECT id, name, contact_email, stripe_account_id FROM service_partners WHERE id = $1 LIMIT 1`,
    [body.partnerId],
  )
  const partner = rows[0]
  if (!partner) return NextResponse.json({ error: "Partner not found" }, { status: 404 })

  const Stripe = (await import("stripe")).default
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2026-03-25.dahlia" })

  let accountId = partner.stripe_account_id
  if (!accountId) {
    const account = await stripe.accounts.create({
      type: "express",
      email: partner.contact_email ?? undefined,
      business_type: "company",
      capabilities: { transfers: { requested: true } },
      metadata: { partnerId: partner.id, partnerName: partner.name },
    })
    accountId = account.id
    await pool.query(
      `UPDATE service_partners SET stripe_account_id = $1, updated_at = now() WHERE id = $2`,
      [accountId, partner.id],
    )
  }

  const origin = resolveAppOrigin(request)
  const link = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: `${origin}/api/immigration/partners/onboard/refresh?partner=${partner.id}`,
    return_url: `${origin}/dashboard/admin?partner_onboarded=${partner.id}`,
    type: "account_onboarding",
  })

  return NextResponse.json({ url: link.url, accountId })
}
