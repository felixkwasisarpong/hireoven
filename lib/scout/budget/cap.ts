/**
 * Hard daily-spend ceiling for all Anthropic calls.
 *
 * Source of truth: the `api_usage` table, which every AI call already
 * writes to via lib/admin/usage.ts → logApiUsage(). Summing today's rows
 * gives an accurate, restart-safe number.
 *
 * Behaviour:
 *   - Cap is set by AI_DAILY_BUDGET_USD env var (default $5). 0 = uncapped.
 *   - Caches the spend total in-process for 60s so we don't query Postgres
 *     on every AI call. Cache is per-container — if you scale horizontally,
 *     each replica computes its own view, which slightly over-counts at
 *     boundaries. Fine for a kill switch.
 *   - When the cap is hit, callers receive a structured "paused" response;
 *     no Anthropic call is made.
 *
 * This is intentionally minimal: a single Postgres SUM query, no Redis, no
 * background worker. It's a circuit breaker, not a billing system.
 */
import { getPostgresPool } from "@/lib/postgres/server"

const DEFAULT_DAILY_CAP_USD = Number.parseFloat(process.env.AI_DAILY_BUDGET_USD ?? "5")
const CAP_CACHE_TTL_MS = 60_000

type CacheEntry = { spendUsd: number; expiresAt: number }
const globalForCap = globalThis as typeof globalThis & { _aiBudgetCache?: CacheEntry }

/** Returns today's Anthropic spend in USD, summed from api_usage. */
export async function getTodaysAiSpendUsd(): Promise<number> {
  const cached = globalForCap._aiBudgetCache
  if (cached && cached.expiresAt > Date.now()) return cached.spendUsd

  try {
    const pool = getPostgresPool()
    const { rows } = await pool.query<{ total: string | null }>(
      `SELECT COALESCE(SUM(cost_usd), 0)::text AS total
       FROM api_usage
       WHERE service = 'claude'
         AND created_at >= date_trunc('day', NOW())`,
    )
    const total = Number(rows[0]?.total ?? 0)
    globalForCap._aiBudgetCache = { spendUsd: total, expiresAt: Date.now() + CAP_CACHE_TTL_MS }
    return total
  } catch {
    // If we can't read the table, fail open — don't break the app over a
    // monitoring bug. The 60s cache means transient outages are smoothed.
    return 0
  }
}

/** True iff today's Anthropic spend has hit or exceeded the configured cap. */
export async function isAiBudgetExceeded(): Promise<boolean> {
  if (DEFAULT_DAILY_CAP_USD <= 0) return false
  const spend = await getTodaysAiSpendUsd()
  return spend >= DEFAULT_DAILY_CAP_USD
}

/** Configured daily cap in USD (read-only at import time). */
export function getDailyAiBudgetCapUsd(): number {
  return DEFAULT_DAILY_CAP_USD
}

/**
 * Drop the in-process cache. Called after a successful AI call so the next
 * budget check sees the updated number sooner than 60s.
 */
export function invalidateAiBudgetCache(): void {
  globalForCap._aiBudgetCache = undefined
}
