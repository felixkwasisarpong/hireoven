import { getSessionUser } from "@/lib/auth/session-user"
import { getBillingHistoryByUserId } from "@/lib/billing/history"
import { getPostgresPool } from "@/lib/postgres/server"
import { getUserPlan } from "@/lib/gates/server-gate"
import { getBalance } from "@/lib/apex/interview/credits"
import { getAllQuotas } from "@/lib/usage/quotas-server"
import { FEATURE_QUOTAS, METERED_FEATURE_KEYS, type MeteredFeature } from "@/lib/usage/quotas"
import { buildSubscriptionSnapshot } from "@/lib/subscription/snapshot"
import type { BillingInterval } from "@/lib/pricing"
import BillingPageClient, {
  type BillingHistoryData,
  type BillingInfo,
  type UsageData,
} from "./BillingPageClient"

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
  initialHistory: BillingHistoryData | null
  initialHistoryLoaded: boolean
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
  const { plan } = await getUserPlan()
  const pool = getPostgresPool()
  const [quotas, packRows, interviewBalance] = await Promise.all([
    getAllQuotas(userId, plan),
    pool.query<{ feature: string; remaining: string }>(
      `SELECT feature, COALESCE(SUM(credits_remaining), 0)::text AS remaining
       FROM feature_credit_packs
       WHERE user_id = $1
         AND credits_remaining > 0
         AND (expires_at IS NULL OR expires_at > NOW())
       GROUP BY feature`,
      [userId],
    ),
    getBalance(userId, plan),
  ])

  const packBalances = METERED_FEATURE_KEYS.reduce<Record<MeteredFeature, number>>(
    (acc, feature) => {
      acc[feature] = 0
      return acc
    },
    {} as Record<MeteredFeature, number>,
  )
  for (const row of packRows.rows) {
    if ((METERED_FEATURE_KEYS as string[]).includes(row.feature)) {
      packBalances[row.feature as MeteredFeature] = Number(row.remaining)
    }
  }

  return {
    plan: plan ?? "free",
    quotas,
    config: FEATURE_QUOTAS,
    packBalances,
    interviewCredits: {
      balance: interviewBalance.balance,
      pendingProMaxGrant: interviewBalance.pendingProMaxGrant,
    },
  }
}

async function getBillingInitialData(userId: string | null): Promise<BillingInitialData> {
  const fallback: BillingInitialData = {
    initialBilling: null,
    initialBillingLoaded: false,
    initialUsage: null,
    initialUsageLoaded: false,
    initialHistory: null,
    initialHistoryLoaded: false,
  }

  if (!userId) return fallback

  try {
    const [billingResult, usageResult, historyResult] = await Promise.allSettled([
      fetchInitialBilling(userId),
      fetchInitialUsage(userId),
      getBillingHistoryByUserId(userId),
    ])

    return {
      initialBilling: billingResult.status === "fulfilled" ? billingResult.value : null,
      initialBillingLoaded: billingResult.status === "fulfilled",
      initialUsage: usageResult.status === "fulfilled" ? usageResult.value : null,
      initialUsageLoaded: usageResult.status === "fulfilled",
      initialHistory: historyResult.status === "fulfilled" ? historyResult.value : null,
      initialHistoryLoaded: historyResult.status === "fulfilled",
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
      initialHistory={initialData.initialHistory}
      initialHistoryLoaded={initialData.initialHistoryLoaded}
      returnedFromPortal={returnedFromPortal}
    />
  )
}
