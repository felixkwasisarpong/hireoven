/**
 * Cap enforcement for overnight auto-apply.
 *
 * Caps live in auto_apply_limits (a table, not constants) so they can be
 * retuned without a deploy. Measured cost is ~$0.0005-0.0025 per application,
 * so the weekly number is a positioning decision rather than a margin one —
 * which is precisely why it needs to move quickly.
 *
 * Three independent gates, all fail-closed:
 *
 *   weekly   how much a user gets per calendar week
 *   nightly  stops one night's run consuming the whole week, and spreads
 *            applications across postings instead of bunching them
 *   dollars  the real backstop. One pathological form — a 30-question flow, a
 *            15k-token JD — breaks any per-application cost model, so the spend
 *            ceiling is enforced on measured spend rather than on a count.
 *
 * Auto-apply is the first feature here whose consumption is not human-paced. A
 * scheduled worker consumes its entire allowance every period for every enabled
 * user, so the low average utilisation that keeps the other quotas safe does not
 * apply and every cap must hold on its own.
 */

import { getPostgresPool } from "@/lib/postgres/server"
import type { Plan } from "@/lib/gates"

export type AutoApplyLimits = {
  plan: string
  weeklyCap: number
  nightlyCap: number
  monthlyUsdCap: number
  minMatchScore: number
  enabled: boolean
}

export type CapDecision = {
  allowed: number
  reason: "ok" | "disabled" | "weekly_cap" | "nightly_cap" | "spend_cap"
  usedThisWeek: number
  usedTonight: number
  spentThisMonthUsd: number
  limits: AutoApplyLimits
}

/** Fail closed: an unreadable or missing config grants nothing. */
const DENY_ALL: AutoApplyLimits = {
  plan: "unknown", weeklyCap: 0, nightlyCap: 0,
  monthlyUsdCap: 0, minMatchScore: 100, enabled: false,
}

export async function getAutoApplyLimits(plan: Plan): Promise<AutoApplyLimits> {
  try {
    const pool = getPostgresPool()
    const { rows } = await pool.query<{
      plan: string; weekly_cap: number; nightly_cap: number
      monthly_usd_cap: string; min_match_score: number; enabled: boolean
    }>(
      `SELECT plan, weekly_cap, nightly_cap, monthly_usd_cap, min_match_score, enabled
         FROM auto_apply_limits WHERE plan = $1 LIMIT 1`,
      [plan],
    )
    const r = rows[0]
    if (!r) return { ...DENY_ALL, plan }
    return {
      plan: r.plan,
      weeklyCap: r.weekly_cap,
      nightlyCap: r.nightly_cap,
      monthlyUsdCap: Number(r.monthly_usd_cap),
      minMatchScore: r.min_match_score,
      enabled: r.enabled,
    }
  } catch {
    return { ...DENY_ALL, plan }
  }
}

/**
 * How many applications this user may still send right now.
 *
 * `timezone` decides where the week and the night boundaries fall. A cap
 * anchored to UTC would reset mid-evening for a user in the Americas, which is
 * exactly when an overnight run is active.
 */
export async function getRemainingAllowance(
  userId: string,
  plan: Plan,
  timezone = "UTC",
): Promise<CapDecision> {
  const limits = await getAutoApplyLimits(plan)
  const base = {
    usedThisWeek: 0, usedTonight: 0, spentThisMonthUsd: 0, limits,
  }
  if (!limits.enabled || limits.weeklyCap <= 0) {
    return { ...base, allowed: 0, reason: "disabled" }
  }

  try {
    const pool = getPostgresPool()
    const { rows } = await pool.query<{
      week: string; night: string; spend: string
    }>(
      `SELECT
         (SELECT count(*) FROM apex_auto_apply_log
           WHERE user_id = $1 AND status = 'applied'
             AND applied_at >= date_trunc('week', now() AT TIME ZONE $2))::text AS week,
         (SELECT count(*) FROM apex_auto_apply_log
           WHERE user_id = $1 AND status = 'applied'
             AND applied_at >= date_trunc('day', now() AT TIME ZONE $2))::text AS night,
         (SELECT COALESCE(SUM(cost_usd), 0) FROM api_usage
           WHERE user_id = $1
             AND created_at >= date_trunc('month', now() AT TIME ZONE $2))::text AS spend`,
      [userId, timezone],
    )
    const usedThisWeek = Number(rows[0]?.week ?? 0)
    const usedTonight = Number(rows[0]?.night ?? 0)
    const spentThisMonthUsd = Number(rows[0]?.spend ?? 0)
    const state = { usedThisWeek, usedTonight, spentThisMonthUsd, limits }

    if (limits.monthlyUsdCap > 0 && spentThisMonthUsd >= limits.monthlyUsdCap) {
      return { ...state, allowed: 0, reason: "spend_cap" }
    }
    const weekLeft = Math.max(0, limits.weeklyCap - usedThisWeek)
    if (weekLeft === 0) return { ...state, allowed: 0, reason: "weekly_cap" }

    const nightLeft = Math.max(0, limits.nightlyCap - usedTonight)
    if (nightLeft === 0) return { ...state, allowed: 0, reason: "nightly_cap" }

    return { ...state, allowed: Math.min(weekLeft, nightLeft), reason: "ok" }
  } catch {
    // An unreadable ledger must never mean "unlimited". If we cannot prove the
    // user is under their cap, they are over it.
    return { ...base, allowed: 0, reason: "disabled" }
  }
}
