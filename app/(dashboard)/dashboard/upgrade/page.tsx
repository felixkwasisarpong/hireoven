import { getSessionUser } from "@/lib/auth/session-user"
import { getPostgresPool } from "@/lib/postgres/server"
import { buildSubscriptionSnapshot } from "@/lib/subscription/snapshot"
import type { BillingInterval, PlanKey } from "@/lib/pricing"
import type { VisaStatus } from "@/types"
import UpgradePageClient from "./UpgradePageClient"

export const dynamic = "force-dynamic"

type SearchParams = Record<string, string | string[] | undefined>

type UsageData = {
  cover_letters_used: number
  analyses_used: number
}

type SubscriptionRow = {
  plan: string | null
  status: string | null
  current_period_end: string | null
  billing_interval: string | null
  amount_cents: number | null
  cancel_at_period_end: boolean | null
  trial_end: string | null
}

type ProfileIntlRow = {
  is_international: boolean
  visa_status: VisaStatus | null
  needs_sponsorship: boolean
}

type UpgradeInitialData = {
  initialUsage: UsageData | null
  initialUsageLoaded: boolean
  initialPlan: PlanKey | null
  initialPlanLoaded: boolean
  initialIsIntlUser: boolean
}

function firstValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}

function normalizeInterval(value: string | undefined): BillingInterval {
  return value === "yearly" ? "yearly" : "monthly"
}

function normalizePlan(value: string | undefined): PlanKey | null {
  if (value === "free" || value === "pro" || value === "pro_max") return value
  return null
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
       WHERE user_id = $1::uuid
         AND created_at >= $2`,
      [userId, monthStart.toISOString()],
    ),
    pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM resume_analyses
       WHERE user_id = $1::uuid
         AND created_at >= $2`,
      [userId, monthStart.toISOString()],
    ),
  ])

  return {
    cover_letters_used: Number(coverLetters.rows[0]?.count ?? 0),
    analyses_used: Number(analyses.rows[0]?.count ?? 0),
  }
}

async function fetchInitialPlan(userId: string): Promise<PlanKey> {
  const pool = getPostgresPool()
  const result = await pool.query<SubscriptionRow>(
    `SELECT plan, status, current_period_end, billing_interval, amount_cents, cancel_at_period_end, trial_end
     FROM subscriptions
     WHERE user_id = $1::uuid
       AND status IN ('active', 'trialing', 'past_due', 'unpaid', 'canceled')
     ORDER BY updated_at DESC NULLS LAST, created_at DESC
     LIMIT 1`,
    [userId],
  )

  const snapshot = buildSubscriptionSnapshot(result.rows[0])
  return snapshot.plan
}

async function fetchInitialIntlSignal(userId: string): Promise<boolean> {
  const pool = getPostgresPool()
  const result = await pool.query<ProfileIntlRow>(
    `SELECT is_international, visa_status, needs_sponsorship
     FROM profiles
     WHERE id = $1::uuid
     LIMIT 1`,
    [userId],
  )
  const row = result.rows[0]
  if (!row) return false
  return Boolean(row.is_international || row.visa_status || row.needs_sponsorship)
}

async function getUpgradeInitialData(userId: string | null): Promise<UpgradeInitialData> {
  const fallback: UpgradeInitialData = {
    initialUsage: null,
    initialUsageLoaded: false,
    initialPlan: null,
    initialPlanLoaded: false,
    initialIsIntlUser: false,
  }

  if (!userId) return fallback

  try {
    const [usageResult, planResult, intlResult] = await Promise.allSettled([
      fetchInitialUsage(userId),
      fetchInitialPlan(userId),
      fetchInitialIntlSignal(userId),
    ])

    return {
      initialUsage: usageResult.status === "fulfilled" ? usageResult.value : null,
      initialUsageLoaded: usageResult.status === "fulfilled",
      initialPlan: planResult.status === "fulfilled" ? planResult.value : null,
      initialPlanLoaded: planResult.status === "fulfilled",
      initialIsIntlUser: intlResult.status === "fulfilled" ? intlResult.value : false,
    }
  } catch {
    return fallback
  }
}

export default async function UpgradePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  const sessionUser = await getSessionUser()
  const initialData = await getUpgradeInitialData(sessionUser?.sub ?? null)

  const initialInterval = normalizeInterval(firstValue(params.interval))
  const initialShouldAutoCheckout = firstValue(params.checkout) === "1"
  const initialAutoCheckoutPlan = normalizePlan(firstValue(params.plan))

  return (
    <UpgradePageClient
      initialInterval={initialInterval}
      initialUsage={initialData.initialUsage}
      initialUsageLoaded={initialData.initialUsageLoaded}
      initialPlan={initialData.initialPlan}
      initialPlanLoaded={initialData.initialPlanLoaded}
      initialIsIntlUser={initialData.initialIsIntlUser}
      initialAutoCheckoutPlan={initialAutoCheckoutPlan}
      initialShouldAutoCheckout={initialShouldAutoCheckout}
    />
  )
}
