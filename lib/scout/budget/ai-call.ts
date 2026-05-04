/**
 * Timeout-wrapped Anthropic call helper.
 *
 * Wraps anthropic.messages.create() with:
 *   - AbortSignal timeout (hard deadline)
 *   - Latency tracking → budgetTracker
 *   - Fallback response when timeout fires
 *   - Never bypasses safety / guardrails — timeout returns the fallback, not a hallucination
 */

import type Anthropic from "@anthropic-ai/sdk"
import type { MessageParam, MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages"
import type { ScoutFeature, ModelTier } from "./types"
import { budgetTracker, calcCost, inferTier } from "./tracker"
import { logApiUsage } from "@/lib/admin/usage"

export type AICallOptions<T> = {
  anthropic:  Anthropic
  feature:    ScoutFeature
  params:     Omit<MessageCreateParamsNonStreaming, "stream">
  timeoutMs:  number
  /** Called when timeout fires. Return a safe deterministic response. */
  fallback:   () => T
  /** Parse the Anthropic Message into your domain type */
  parse:      (content: string) => T
  userId?:    string
}

export type AICallResult<T> = {
  value:      T
  timedOut:   boolean
  latencyMs:  number
  inputTokens:  number
  outputTokens: number
  costUsd:    number
  cached:     boolean
}

export async function withAICall<T>({
  anthropic,
  feature,
  params,
  timeoutMs,
  fallback,
  parse,
  userId,
}: AICallOptions<T>): Promise<AICallResult<T>> {
  const start   = Date.now()
  const tier    = inferTier(params.model)
  const model   = params.model
  let timedOut  = false
  let success   = true
  let inputTokens  = 0
  let outputTokens = 0
  let costUsd      = 0
  let value: T

  const controller = new AbortController()
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  try {
    const message = await (anthropic.messages.create as (
      p: MessageCreateParamsNonStreaming & { signal?: AbortSignal }
    ) => Promise<Anthropic.Message>)({
      ...params,
      stream: false,
      signal: controller.signal,
    })

    inputTokens  = message.usage?.input_tokens  ?? 0
    outputTokens = message.usage?.output_tokens ?? 0
    costUsd      = calcCost(tier, inputTokens, outputTokens)

    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim()

    value = parse(text)
  } catch (err) {
    success = false
    if (timedOut || (err instanceof Error && err.name === "AbortError")) {
      timedOut = true
    }
    value = fallback()
  } finally {
    clearTimeout(timer)
  }

  const latencyMs = Date.now() - start

  budgetTracker.record({
    feature, model, tier,
    inputTokens, outputTokens, latencyMs, costUsd,
    success, cached: false, timedOut,
    userId, timestamp: Date.now(),
  })

  if (success && inputTokens > 0) {
    void logApiUsage({
      service:     "claude",
      operation:   feature,
      tokens_used: inputTokens + outputTokens,
      cost_usd:    Number(costUsd.toFixed(6)),
    }).catch(() => {})
  }

  return { value, timedOut, latencyMs, inputTokens, outputTokens, costUsd, cached: false }
}

// ── Streaming helper — attaches timeout to a stream that's already started ────

export function streamWithTimeout(
  streamPromise: ReturnType<Anthropic["messages"]["stream"]>,
  timeoutMs: number,
): { stream: typeof streamPromise; abort: () => void } {
  let aborted = false
  const timer = setTimeout(() => {
    aborted = true
    try { streamPromise.abort() } catch {}
  }, timeoutMs)

  streamPromise.finalMessage().then(() => clearTimeout(timer)).catch(() => clearTimeout(timer))

  return {
    stream: streamPromise,
    abort:  () => { if (!aborted) { clearTimeout(timer); try { streamPromise.abort() } catch {} } },
  }
}

// ── Record a cached hit into the tracker ─────────────────────────────────────

export function recordCacheHit(feature: ScoutFeature, model: string, userId?: string): void {
  budgetTracker.record({
    feature, model, tier: inferTier(model),
    inputTokens: 0, outputTokens: 0, latencyMs: 0, costUsd: 0,
    success: true, cached: true, timedOut: false,
    userId, timestamp: Date.now(),
  })
}

// ── Simple text extractor ─────────────────────────────────────────────────────

export function extractText(params: MessageParam[]): string {
  return params
    .flatMap((m) => (typeof m.content === "string" ? [m.content] : []))
    .join(" ")
    .slice(0, 500)
}
