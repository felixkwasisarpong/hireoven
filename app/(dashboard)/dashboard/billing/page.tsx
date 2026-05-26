import { getSessionUser } from "@/lib/auth/session-user"
import { getPostgresPool } from "@/lib/postgres/server"
import { buildSubscriptionSnapshot } from "@/lib/subscription/snapshot"
import type { BillingInterval } from "@/lib/pricing"
import BillingPageClient, { type BillingInfo, type UsageData } from "./BillingPageClient"

export const dynamic = "force-dynamic"

type SearchParams = Record<string, string | string[] | undefined>

type SubscriptionRow = {
  plan: string | null
  status: string | null
  current_period_end: string | null
  billing_interval: string | null
  amount_cents: number | null
  cancel_at_period_end: boolean | null
  trial_end: string | null
}

type BillingInitialData = {
  initialBilling: BillingInfo | null
  initialBillingLoaded: boolean
  initialUsage: UsageData | null
  initialUsageLoaded: boolean
}

function firstValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}

async function fetchInitialBilling(userId: string): Promise<BillingInfo | null> {
  const pool = getPostgresPool()
  const result = await pool.query<SubscriptionRow>(
    `SELECT plan, status, current_period_end, billing_interval, amount_cents, cancel_at_period_end, trial_end
     FROM subscriptions
     WHERE user_id = $1
       AND status IN ('active', 'trialing', 'past_due', 'unpaid', 'canceled')
     ORDER BY updated_at DESC NULLS LAST, created_at DESC
     LIMIT 1`,
    [userId],
  )

  const snapshot = buildSubscriptionSnapshot(result.rows[0])
  return {
    plan: snapshot.plan,
    status: snapshot.status,
    currentPeriodEnd: snapshot.currentPeriodEnd,
    billingInterval: snapshot.billingInterval as BillingInterval | null,
    amountCents: snapshot.amountCents,
    cancelAtPeriodEnd: snapshot.cancelAtPeriodEnd,
  }
}

async function fetchInitialUsage(userId: string): Promise<UsageData> {
  const monthStart = new Date()
  monthStart.setUTCDate(1)
  monthStart.setUTCHours(0, 0, 0, 0)

  const pool = getPostgresPool()
  const [coverLetters, analyses] = await Promise.all([
    pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM cover_letters
       WHERE user_id = $1
         AND created_at >= $2`,
      [userId, monthStart.toISOString()],
    ),
    pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM resume_analyses
       WHERE user_id = $1
         AND created_at >= $2`,
      [userId, monthStart.toISOString()],
    ),
  ])

  return {
    cover_letters_used: Number(coverLetters.rows[0]?.count ?? 0),
    analyses_used: Number(analyses.rows[0]?.count ?? 0),
  }
}

async function getBillingInitialData(userId: string | null): Promise<BillingInitialData> {
  const fallback: BillingInitialData = {
    initialBilling: null,
    initialBillingLoaded: false,
    initialUsage: null,
    initialUsageLoaded: false,
  }

  if (!userId) return fallback

  try {
    const [billingResult, usageResult] = await Promise.allSettled([
      fetchInitialBilling(userId),
      fetchInitialUsage(userId),
    ])

    return {
      initialBilling: billingResult.status === "fulfilled" ? billingResult.value : null,
      initialBillingLoaded: billingResult.status === "fulfilled",
      initialUsage: usageResult.status === "fulfilled" ? usageResult.value : null,
      initialUsageLoaded: usageResult.status === "fulfilled",
    }
  } catch {
    return fallback
  }
}

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  const sessionUser = await getSessionUser()
  const initialData = await getBillingInitialData(sessionUser?.sub ?? null)
  const returnedFromPortal = firstValue(params.portal) === "return"

  return (
    <BillingPageClient
      initialBilling={initialData.initialBilling}
      initialBillingLoaded={initialData.initialBillingLoaded}
      initialUsage={initialData.initialUsage}
      initialUsageLoaded={initialData.initialUsageLoaded}
      returnedFromPortal={returnedFromPortal}
    />
  )
}
