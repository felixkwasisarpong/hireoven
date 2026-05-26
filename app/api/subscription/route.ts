import { NextResponse } from "next/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { createClient } from "@/lib/supabase/server"
import { buildSubscriptionSnapshot } from "@/lib/subscription/snapshot"

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ plan: null }, { status: 401 })

  const pool = getPostgresPool()
  const result = await pool.query<{
    plan: string | null
    status: string | null
    current_period_end: string | null
    billing_interval: string | null
    amount_cents: number | null
    cancel_at_period_end: boolean | null
    trial_end: string | null
  }>(
    `SELECT plan, status, current_period_end, billing_interval, amount_cents, cancel_at_period_end, trial_end
     FROM subscriptions
     WHERE user_id = $1
       AND status IN ('active', 'trialing', 'past_due', 'unpaid', 'canceled')
     ORDER BY updated_at DESC NULLS LAST, created_at DESC
     LIMIT 1`,
    [user.id]
  )
  const snapshot = buildSubscriptionSnapshot(result.rows[0])

  return NextResponse.json({
    plan: snapshot.plan,
    status: snapshot.status,
    currentPeriodEnd: snapshot.currentPeriodEnd,
    billingInterval: snapshot.billingInterval,
    amountCents: snapshot.amountCents,
    cancelAtPeriodEnd: snapshot.cancelAtPeriodEnd,
    trialEnd: snapshot.trialEnd,
    trialDaysRemaining: snapshot.trialDaysRemaining,
  })
}
