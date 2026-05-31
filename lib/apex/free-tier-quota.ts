import type { Plan } from "@/lib/gates"
import { FEATURE_QUOTAS, type QuotaState } from "@/lib/usage/quotas"
import { bumpUsage } from "@/lib/usage/quotas-server"

/** Kept for backwards compatibility; canonical limits live in FEATURE_QUOTAS. */
export const FREE_DAILY_APEX_QUOTA = FEATURE_QUOTAS.apex_message.limits.free

export type { QuotaState }

/**
 * Bumps the user's daily Apex message counter via the generic feature_usage
 * table and returns the post-increment state. Always increments — caller decides
 * whether to fulfil or 429 based on `exceeded`. Pro users still consume credits
 * but against their (much higher) plan limit.
 */
export async function bumpApexUsage(userId: string, plan: Plan | null = "free"): Promise<QuotaState> {
  return bumpUsage(userId, "apex_message", plan)
}
