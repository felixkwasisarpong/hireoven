import { NextResponse } from "next/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { createClient } from "@/lib/supabase/server"
import type { Plan } from "@/lib/gates"

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
     ORDER BY created_at DESC
     LIMIT 1`,
    [user.id]
  )
  const sub = result.rows[0]

  const plan: Plan = (sub?.plan as Plan) ?? "free"
  const trialEnd = sub?.trial_end ?? sub?.current_period_end ?? null
  const trialDaysRemaining =
    sub?.status === "trialing" && trialEnd
      ? Math.max(0, Math.ceil((new Date(trialEnd).getTime() - Date.now()) / 86_400_000))
      : null

  return NextResponse.json({
    plan,
    status: sub?.status ?? "free",
    currentPeriodEnd: sub?.current_period_end ?? null,
    billingInterval: sub?.billing_interval ?? null,
    amountCents: sub?.amount_cents ?? null,
    cancelAtPeriodEnd: Boolean(sub?.cancel_at_period_end),
    trialEnd,
    trialDaysRemaining,
  })
}
