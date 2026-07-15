import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { getUserIdByReferralCode } from "@/lib/referral/codes"
import { grantRefereeReward } from "@/lib/referral/rewards"

export const runtime = "nodejs"

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = (await request.json().catch(() => ({}))) as { code?: string }
  const code = body.code?.trim().toUpperCase()
  if (!code) return NextResponse.json({ error: "code is required" }, { status: 400 })

  const pool = getPostgresPool()

  // Don't let a user refer themselves
  const referrerId = await getUserIdByReferralCode(pool, code)
  if (!referrerId) {
    return NextResponse.json({ error: "Invalid referral code" }, { status: 404 })
  }
  if (referrerId === user.id) {
    return NextResponse.json({ error: "You cannot refer yourself" }, { status: 400 })
  }

  // Idempotency: if referee already has a referral record, return it
  const existing = await pool.query<{ id: string }>(
    `SELECT id FROM referrals WHERE referee_id = $1 LIMIT 1`,
    [user.id]
  )
  if (existing.rows.length > 0) {
    return NextResponse.json({ ok: true, alreadyClaimed: true })
  }

  // Create the referral record
  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO referrals (referrer_id, referee_id, status)
     VALUES ($1, $2, 'pending')
     ON CONFLICT (referee_id) DO NOTHING
     RETURNING id`,
    [referrerId, user.id]
  )
  const referralId = inserted.rows[0]?.id
  if (!referralId) {
    return NextResponse.json({ ok: true, alreadyClaimed: true })
  }

  // Grant the referee their 7-day Pro trial immediately
  await grantRefereeReward(pool, referralId, user.id)

  return NextResponse.json({ ok: true, alreadyClaimed: false })
}
