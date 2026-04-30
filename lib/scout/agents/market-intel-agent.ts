/**
 * MarketIntelAgent
 *
 * Loads live market signals (hiring velocity, sponsorship trends, ghost job
 * risk) and formats them into a concise context section for Claude.
 *
 * Currently market signals are only available in the shell (fetched at page
 * load). This agent makes them available in every chat request where relevant.
 */

import type { ScoutAgent, ScoutExecutionContext, AgentResult } from "./types"
import type { MarketSignal } from "@/lib/scout/market-intelligence"
import { formatMarketSignalsForClaude } from "@/lib/scout/market-intelligence"

const RELEVANT_INTENTS = ["search", "compare", "market", "general"] as const

type MarketResult = { signals: MarketSignal[] }

export class MarketIntelAgent implements ScoutAgent<MarketResult> {
  readonly id = "market"
  readonly relevantIntents = [...RELEVANT_INTENTS] as import("./types").AgentIntent[]

  async run(ctx: ScoutExecutionContext): Promise<AgentResult<MarketResult>> {
    const start = Date.now()
    try {
      // Re-use the existing market intelligence function — same DB queries the
      // /api/scout/market endpoint uses, now available inline for chat context.
      const { getMarketIntelligence } = await import("@/lib/scout/market-intelligence")
      const result = await getMarketIntelligence(ctx.userId)

      if (!result.signals.length) {
        return { agentId: this.id, success: true, durationMs: Date.now() - start }
      }

      const contextSection = formatMarketSignalsForClaude(result.signals)
      return {
        agentId: this.id,
        success: true,
        data:    { signals: result.signals },
        contextSection: contextSection
          ? `\nLive Market Signals (use cautiously — phrased with appropriate uncertainty):\n${contextSection}`
          : undefined,
        durationMs: Date.now() - start,
      }
    } catch (err) {
      return {
        agentId:   this.id,
        success:   false,
        durationMs: Date.now() - start,
        error:     err instanceof Error ? err.message : "Market intel failed",
      }
    }
  }
}
