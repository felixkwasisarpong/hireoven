/**
 * GET  /api/immigration/services — the offering catalog + the user's requests
 * POST /api/immigration/services — submit a consult/service request (a lead)
 *
 * Marketplace MVP: we capture intent with a price snapshot (the platform fee is
 * Hireoven's take-rate). Partner matching + payment collection happen out of
 * band — the request is the booking lead.
 */
import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { SERVICE_OFFERINGS, getOffering, computeQuote } from "@/lib/immigration/services"

export const runtime = "nodejs"

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const pool = getPostgresPool()
  const { rows } = await pool.query(
    `SELECT id, offering_id, category, rush, quoted_price, platform_fee, status, visa_situation, created_at
       FROM immigration_service_requests
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 50`,
    [user.id],
  ).catch(() => ({ rows: [] }))

  return NextResponse.json({ offerings: SERVICE_OFFERINGS, requests: rows })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = (await request.json().catch(() => ({}))) as {
    offeringId?: string; rush?: boolean; visaSituation?: string; contactEmail?: string; notes?: string
  }
  const offering = body.offeringId ? getOffering(body.offeringId) : undefined
  if (!offering) return NextResponse.json({ error: "Unknown service" }, { status: 400 })

  const quote = computeQuote(offering, { rush: body.rush === true })
  const pool = getPostgresPool()

  const res = await pool.query<{ id: string }>(
    `INSERT INTO immigration_service_requests
       (user_id, offering_id, category, rush, quoted_price, platform_fee, provider_net,
        status, visa_situation, contact_email, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'requested',$8,$9,$10)
     RETURNING id`,
    [
      user.id, offering.id, offering.category, body.rush === true,
      quote.price, quote.platformFee, quote.providerNet,
      body.visaSituation?.slice(0, 2000) ?? null,
      body.contactEmail?.slice(0, 200) ?? user.email ?? null,
      body.notes?.slice(0, 2000) ?? null,
    ],
  ).catch((err) => {
    console.error("[immigration/services] create failed:", err)
    return null
  })

  if (!res?.rows[0]) return NextResponse.json({ error: "Failed to submit request" }, { status: 500 })
  return NextResponse.json({ id: res.rows[0].id, quote }, { status: 201 })
}
