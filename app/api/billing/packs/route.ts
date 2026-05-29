import { NextResponse } from "next/server"
import { getUserPlan } from "@/lib/gates/server-gate"
import { getPostgresPool } from "@/lib/postgres/server"
import { FEATURE_PACKS } from "@/lib/billing/packs"
import { METERED_FEATURE_KEYS, type MeteredFeature } from "@/lib/usage/quotas"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const { userId } = await getUserPlan()
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const pool = getPostgresPool()
  const { rows } = await pool.query<{ feature: string; remaining: string }>(
    `SELECT feature, COALESCE(SUM(credits_remaining), 0)::text AS remaining
     FROM feature_credit_packs
     WHERE user_id = $1
       AND credits_remaining > 0
       AND (expires_at IS NULL OR expires_at > NOW())
     GROUP BY feature`,
    [userId]
  )

  const balances = METERED_FEATURE_KEYS.reduce<Record<MeteredFeature, number>>(
    (acc, feature) => {
      acc[feature] = 0
      return acc
    },
    {} as Record<MeteredFeature, number>
  )
  for (const row of rows) {
    if ((METERED_FEATURE_KEYS as string[]).includes(row.feature)) {
      balances[row.feature as MeteredFeature] = Number(row.remaining)
    }
  }

  return NextResponse.json({
    catalog: FEATURE_PACKS,
    balances,
  })
}
