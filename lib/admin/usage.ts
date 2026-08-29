import { getPostgresPool } from "@/lib/postgres/server"
import { ANTHROPIC_TIER_PRICING } from "@/lib/ai/anthropic-models"
import type { ApiUsageInsert } from "@/types"

/**
 * Effective cost of an Anthropic call, accounting for prompt caching.
 *
 * Cache reads bill at 0.1x base input and cache writes at 1.25x, so a call that
 * reuses a large cached prefix costs a fraction of what `input_tokens` alone
 * would imply. Computing this at log time keeps the arithmetic in one place —
 * call sites report raw token counts and never do pricing math themselves.
 */
export function calcAnthropicCostUsd(args: {
  tier: keyof typeof ANTHROPIC_TIER_PRICING
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}): number {
  const price = ANTHROPIC_TIER_PRICING[args.tier]
  const perInputToken = price.inputPerMillion / 1_000_000
  const cost =
    args.inputTokens * perInputToken +
    args.outputTokens * (price.outputPerMillion / 1_000_000) +
    (args.cacheReadTokens ?? 0) * perInputToken * 0.1 +
    (args.cacheWriteTokens ?? 0) * perInputToken * 1.25
  return Number(cost.toFixed(6))
}

export async function logApiUsage(entry: ApiUsageInsert) {
  try {
    const pool = getPostgresPool()
    // tokens_used stays populated for continuity with historical rows and the
    // existing daily-cap query; the split columns are the ones to read going forward.
    const combined =
      entry.tokens_used ??
      (entry.input_tokens != null || entry.output_tokens != null
        ? (entry.input_tokens ?? 0) + (entry.output_tokens ?? 0)
        : null)

    await pool.query(
      `INSERT INTO api_usage
         (service, operation, tokens_used, cost_usd,
          user_id, feature, model, input_tokens, output_tokens,
          cache_read_tokens, cache_write_tokens, run_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        entry.service,
        entry.operation ?? null,
        combined,
        entry.cost_usd ?? null,
        entry.user_id ?? null,
        entry.feature ?? entry.operation ?? null,
        entry.model ?? null,
        entry.input_tokens ?? null,
        entry.output_tokens ?? null,
        entry.cache_read_tokens ?? null,
        entry.cache_write_tokens ?? null,
        entry.run_id ?? null,
      ]
    )
  } catch (error) {
    console.error("Failed to log api_usage", error)
  }
}
