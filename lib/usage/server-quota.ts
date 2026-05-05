import { NextResponse } from "next/server"
import type { Plan } from "@/lib/gates"
import { FEATURE_QUOTAS, type MeteredFeature, type QuotaState } from "./quotas"
import { bumpUsage } from "./quotas-server"

/**
 * Bumps usage and returns either the post-bump state or a 429 NextResponse if
 * the user has exceeded their quota. Bump-then-check (not check-then-bump) so
 * that retries cannot bypass the cap.
 */
export async function requireQuota(
  userId: string,
  feature: MeteredFeature,
  plan: Plan | null
): Promise<QuotaState | NextResponse> {
  const state = await bumpUsage(userId, feature, plan)
  if (!state.exceeded) return state

  const config = FEATURE_QUOTAS[feature]
  const periodWord = config.period === "day" ? "today" : "this month"
  return NextResponse.json(
    {
      error: `You've used your ${state.limit} ${config.label.toLowerCase()} ${periodWord}.`,
      code: "QUOTA_EXCEEDED",
      feature,
      quota: state,
    },
    { status: 429 }
  )
}
