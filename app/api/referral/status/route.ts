import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { getOrCreateReferralCode } from "@/lib/referral/codes"
import { resolveAppOrigin } from "@/lib/app-url"

export const runtime = "nodejs"

type ReferralRow = {
  id: string
  referee_id: string
  status: string
  created_at: string
  converted_at: string | null
  referrer_reward_granted_at: string | null
  referee_name: string | null
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const pool = getPostgresPool()

  const [codeResult, referralsResult] = await Promise.all([
    getOrCreateReferralCode(pool, user.id),
    pool.query<ReferralRow>(
      `SELECT r.id, r.referee_id, r.status, r.created_at, r.converted_at,
              r.referrer_reward_granted_at,
              p.full_name AS referee_name
         FROM referrals r
         JOIN profiles p ON p.id = r.referee_id
        WHERE r.referrer_id = $1
        ORDER BY r.created_at DESC`,
      [user.id]
    ),
  ])

  const referrals = referralsResult.rows
  const converted = referrals.filter((r) => r.referrer_reward_granted_at !== null)
  const pending = referrals.filter(
    (r) => r.referrer_reward_granted_at === null && r.status === "pending"
  )

  // Days earned: 14 per converted referral, capped at 3
  const daysEarned = Math.min(converted.length, 3) * 14

  return NextResponse.json({
    code: codeResult,
    url: `${resolveAppOrigin()}/ref/${codeResult}`,
    totalReferrals: referrals.length,
    convertedReferrals: converted.length,
    pendingReferrals: pending.length,
    daysEarned,
    capReached: converted.length >= 3,
    referrals: referrals.map((r) => ({
      id: r.id,
      refereeName: r.referee_name
        ? r.referee_name.split(" ")[0]  // first name only for privacy
        : "Someone",
      status: r.referrer_reward_granted_at ? "rewarded" : r.status,
      joinedAt: r.created_at,
      convertedAt: r.converted_at,
    })),
  })
}
