import { createAdminClient } from "@/lib/supabase/admin"
import { getPlanAmountCents } from "@/lib/pricing"

export async function startTrial(
  userId: string,
  plan: "pro" | "pro_international",
  interval: "monthly" | "yearly",
  trialEnd: Date,
  stripeSubscriptionId: string,
  stripeCustomerId: string
): Promise<void> {
  const supabase = createAdminClient()

  await supabase.from("subscriptions" as any).upsert(
    {
      user_id: userId,
      plan,
      status: "trialing",
      stripe_subscription_id: stripeSubscriptionId,
      stripe_customer_id: stripeCustomerId,
      billing_interval: interval,
      amount_cents: getPlanAmountCents(plan, interval),
      current_period_start: new Date().toISOString(),
      current_period_end: trialEnd.toISOString(),
      trial_end: trialEnd.toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "stripe_subscription_id" }
  )
}

export async function isInTrial(userId: string): Promise<boolean> {
  const days = await getTrialDaysRemaining(userId)
  return days !== null && days > 0
}

export async function getTrialDaysRemaining(userId: string): Promise<number | null> {
  const supabase = createAdminClient()

  const { data } = await (supabase as any)
    .from("subscriptions" as any)
    .select("status, current_period_end")
    .eq("user_id", userId)
    .eq("status", "trialing")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!data?.current_period_end) return null

  const end = new Date(data.current_period_end).getTime()
  const now = Date.now()
  if (end <= now) return 0

  return Math.ceil((end - now) / (1000 * 60 * 60 * 24))
}
