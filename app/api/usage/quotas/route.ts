import { NextRequest, NextResponse } from "next/server"
import { getUserPlan } from "@/lib/gates/server-gate"
import { getPostgresPool } from "@/lib/postgres/server"
import { FEATURE_QUOTAS, METERED_FEATURE_KEYS, type MeteredFeature } from "@/lib/usage/quotas"
import { getAllQuotas } from "@/lib/usage/quotas-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const { userId, plan } = await getUserPlan(request)
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Top-up pack credits ride along with the base quotas — the credit widgets
  // display remaining as base + pack, matching what bumpUsage() will actually
  // allow (it falls through to tryConsumePackCredit once base is exhausted).
  const [quotas, packRows] = await Promise.all([
    getAllQuotas(userId, plan),
    getPostgresPool().query<{ feature: string; remaining: string }>(
      `SELECT feature, COALESCE(SUM(credits_remaining), 0)::text AS remaining
       FROM feature_credit_packs
       WHERE user_id = $1
         AND credits_remaining > 0
         AND (expires_at IS NULL OR expires_at > NOW())
       GROUP BY feature`,
      [userId]
    ),
  ])

  const packBalances = METERED_FEATURE_KEYS.reduce<Record<MeteredFeature, number>>(
    (acc, feature) => {
      acc[feature] = 0
      return acc
    },
    {} as Record<MeteredFeature, number>
  )
  for (const row of packRows.rows) {
    if ((METERED_FEATURE_KEYS as string[]).includes(row.feature)) {
      packBalances[row.feature as MeteredFeature] = Number(row.remaining)
    }
  }

  return NextResponse.json({
    plan: plan ?? "free",
    quotas,
    config: FEATURE_QUOTAS,
    packBalances,
  })
}
