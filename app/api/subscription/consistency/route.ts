import { NextResponse } from "next/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { buildSubscriptionSnapshot, evaluateSubscriptionSnapshotConsistency } from "@/lib/subscription/snapshot"
import { createClient } from "@/lib/supabase/server"

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const pool = getPostgresPool()
  const result = await pool.query<{
    plan: string | null
    status: string | null
    current_period_end: string | null
    billing_interval: string | null
    amount_cents: number | null
    cancel_at_period_end: boolean | null
    trial_end: string | null
    stripe_subscription_id: string | null
    stripe_customer_id: string | null
    updated_at: string | null
    created_at: string | null
  }>(
    `SELECT
       plan,
       status,
       current_period_end,
       billing_interval,
       amount_cents,
       cancel_at_period_end,
       trial_end,
       stripe_subscription_id,
       stripe_customer_id,
       updated_at,
       created_at
     FROM subscriptions
     WHERE user_id = $1
     ORDER BY updated_at DESC NULLS LAST, created_at DESC
     LIMIT 1`,
    [user.id]
  )

  const latest = result.rows[0]
  const snapshot = buildSubscriptionSnapshot(latest)
  const consistency = evaluateSubscriptionSnapshotConsistency(snapshot)

  return NextResponse.json({
    ok: consistency.ok,
    snapshot,
    issues: consistency.issues,
    source: latest
      ? {
          status: latest.status,
          plan: latest.plan,
          stripeSubscriptionId: latest.stripe_subscription_id,
          stripeCustomerId: latest.stripe_customer_id,
          updatedAt: latest.updated_at,
          createdAt: latest.created_at,
        }
      : null,
  })
}
