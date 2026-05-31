/**
 * Scout Budget Tracker — in-memory ring buffer of recent AI calls.
 *
 * Stores the last RING_SIZE entries in memory for the dev dashboard.
 * Does NOT replace DB logging — existing logApiUsage() calls remain.
 */

import type { BudgetEntry, BudgetStats, FeatureStats, ModelTier } from "./types"
import { ANTHROPIC_TIER_PRICING } from "@/lib/ai/anthropic-models"

const RING_SIZE = 500

class BudgetTracker {
  private ring: BudgetEntry[] = []
  private cursor = 0
  private total  = 0

  record(entry: BudgetEntry): void {
    if (this.ring.length < RING_SIZE) {
      this.ring.push(entry)
    } else {
      this.ring[this.cursor] = entry
    }
    this.cursor = (this.cursor + 1) % RING_SIZE
    this.total++
  }

  recent(n = 100): BudgetEntry[] {
    const filled = Math.min(this.total, RING_SIZE)
    const entries = this.ring.slice(0, filled)
    // Sort descending by timestamp
    return entries.sort((a, b) => b.timestamp - a.timestamp).slice(0, n)
  }

  stats(): BudgetStats {
    const entries = this.recent(RING_SIZE)
    if (entries.length === 0) {
      return { totalCalls: 0, cachedCalls: 0, timedOutCalls: 0, failedCalls: 0, cacheHitRate: 0, totalCostUsd: 0, avgLatencyMs: 0, p95LatencyMs: 0, byFeature: {} }
    }

    const latencies  = entries.map((e) => e.latencyMs).sort((a, b) => a - b)
    const p95Index   = Math.floor(latencies.length * 0.95)
    const byFeature  = new Map<string, FeatureStats>()

    for (const e of entries) {
      const f = byFeature.get(e.feature) ?? {
        calls: 0, cachedCalls: 0, timedOutCalls: 0, failedCalls: 0,
        totalCostUsd: 0, avgLatencyMs: 0, totalInputTokens: 0, totalOutputTokens: 0,
      }
      f.calls++
      if (e.cached)   f.cachedCalls++
      if (e.timedOut) f.timedOutCalls++
      if (!e.success) f.failedCalls++
      f.totalCostUsd        += e.costUsd
      f.avgLatencyMs        = (f.avgLatencyMs * (f.calls - 1) + e.latencyMs) / f.calls
      f.totalInputTokens    += e.inputTokens
      f.totalOutputTokens   += e.outputTokens
      byFeature.set(e.feature, f)
    }

    const cached  = entries.filter((e) => e.cached).length
    const total   = entries.length

    return {
      totalCalls:    total,
      cachedCalls:   cached,
      timedOutCalls: entries.filter((e) => e.timedOut).length,
      failedCalls:   entries.filter((e) => !e.success).length,
      cacheHitRate:  total === 0 ? 0 : cached / total,
      totalCostUsd:  entries.reduce((s, e) => s + e.costUsd, 0),
      avgLatencyMs:  latencies.reduce((s, v) => s + v, 0) / latencies.length,
      p95LatencyMs:  latencies[p95Index] ?? 0,
      byFeature:     Object.fromEntries(byFeature),
    }
  }

  slowest(n = 10): BudgetEntry[] {
    return this.recent(RING_SIZE).sort((a, b) => b.latencyMs - a.latencyMs).slice(0, n)
  }

  mostExpensive(n = 10): BudgetEntry[] {
    return this.recent(RING_SIZE).sort((a, b) => b.costUsd - a.costUsd).slice(0, n)
  }

  failed(n = 20): BudgetEntry[] {
    return this.recent(RING_SIZE).filter((e) => !e.success).slice(0, n)
  }
}

const globalForTracker = globalThis as typeof globalThis & { _scoutBudgetTracker?: BudgetTracker }
export const budgetTracker = globalForTracker._scoutBudgetTracker ?? (globalForTracker._scoutBudgetTracker = new BudgetTracker())

// ── Helpers ───────────────────────────────────────────────────────────────────

export function calcCost(tier: ModelTier, inputTokens: number, outputTokens: number): number {
  const pricing = ANTHROPIC_TIER_PRICING[tier]
  return (inputTokens / 1_000_000) * pricing.inputPerMillion +
         (outputTokens / 1_000_000) * pricing.outputPerMillion
}

export function inferTier(model: string): ModelTier {
  if (model.includes("haiku")) return "haiku"
  if (model.includes("opus"))  return "opus"
  return "sonnet"
}
