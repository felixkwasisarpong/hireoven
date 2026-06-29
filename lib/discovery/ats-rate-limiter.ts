/**
 * Shared, per-ATS-host token-bucket rate limiter.
 *
 * In-memory only — we run a single harvester/discovery process per box, so this
 * is intentionally NOT Redis-backed for now. If discovery ever fans out across
 * machines, swap the bucket store for a shared one behind the same interface.
 *
 * Default: 5 req/sec per host, burst 10, queue cap 200. Requests beyond the
 * burst are queued and drained as tokens refill; if the queue for a host is
 * already at its cap, the call rejects with QueueFullError (callers map this to
 * a 'rate_limited' outcome rather than hammering the board).
 *
 * Env overrides (read lazily, so tests can set them before first use):
 *   ATS_RATE_LIMIT_<HOST>_RPS     e.g. ATS_RATE_LIMIT_GREENHOUSE_RPS=8
 *   ATS_RATE_LIMIT_<HOST>_BURST   e.g. ATS_RATE_LIMIT_GREENHOUSE_BURST=16
 *   ATS_RATE_LIMIT_QUEUE_CAP      global queue depth cap (default 200)
 * <HOST> is the ats_type upper-cased with non-alphanumerics → "_".
 */

import { counter as emitCounter } from "@/lib/observability/metrics"

export type AtsHost = string // 'greenhouse' | 'lever' | 'ashby' | etc.

export class QueueFullError extends Error {
  readonly atsType: string
  constructor(atsType: string) {
    super(`ATS rate limiter queue is full for "${atsType}"`)
    this.name = "QueueFullError"
    this.atsType = atsType
  }
}

const DEFAULT_RPS = 5
const DEFAULT_BURST = 10
const DEFAULT_QUEUE_CAP = 200

type BucketConfig = { rps: number; burst: number }

type Bucket = {
  tokens: number
  lastRefillMs: number
  cfg: BucketConfig
  queue: Array<() => void>
  timer: ReturnType<typeof setTimeout> | null
}

const buckets = new Map<string, Bucket>()

const metrics = {
  /** Current total depth across all host queues (gauge). */
  queued: 0,
  /** Cumulative count of calls that had to wait at least once (counter). */
  throttled: 0,
  /** Cumulative count of tokens granted (counter). */
  acquired: 0,
  /** Cumulative count of QueueFullError rejections (counter). */
  queueFull: 0,
}

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw == null || raw.trim() === "") return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

function queueCap(): number {
  return Math.trunc(envNumber("ATS_RATE_LIMIT_QUEUE_CAP", DEFAULT_QUEUE_CAP))
}

function hostConfig(atsType: string): BucketConfig {
  const key = atsType.toUpperCase().replace(/[^A-Z0-9]+/g, "_")
  return {
    rps: envNumber(`ATS_RATE_LIMIT_${key}_RPS`, DEFAULT_RPS),
    burst: envNumber(`ATS_RATE_LIMIT_${key}_BURST`, DEFAULT_BURST),
  }
}

function getBucket(atsType: string): Bucket {
  let b = buckets.get(atsType)
  if (!b) {
    const cfg = hostConfig(atsType)
    b = { tokens: cfg.burst, lastRefillMs: Date.now(), cfg, queue: [], timer: null }
    buckets.set(atsType, b)
  }
  return b
}

function refill(b: Bucket): void {
  const now = Date.now()
  const elapsedSec = (now - b.lastRefillMs) / 1000
  if (elapsedSec > 0) {
    b.tokens = Math.min(b.cfg.burst, b.tokens + elapsedSec * b.cfg.rps)
    b.lastRefillMs = now
  }
}

function pump(b: Bucket): void {
  refill(b)
  while (b.queue.length > 0 && b.tokens >= 1) {
    b.tokens -= 1
    const next = b.queue.shift()!
    metrics.queued -= 1
    metrics.acquired += 1
    next()
  }
  if (b.queue.length > 0 && !b.timer) {
    // Schedule the next drain for when at least one token will be available.
    const needed = 1 - b.tokens
    const waitMs = b.cfg.rps > 0 ? Math.max(10, Math.ceil((needed / b.cfg.rps) * 1000)) : 60_000
    b.timer = setTimeout(() => {
      b.timer = null
      pump(b)
    }, waitMs)
    // Don't keep the event loop alive solely for the limiter.
    if (typeof b.timer.unref === "function") b.timer.unref()
  }
}

function acquire(atsType: string): Promise<void> {
  const b = getBucket(atsType)
  refill(b)
  // Fast path: a token is free and nobody is ahead of us.
  if (b.queue.length === 0 && b.tokens >= 1) {
    b.tokens -= 1
    metrics.acquired += 1
    return Promise.resolve()
  }
  // Must wait — reject if the queue is already saturated.
  if (b.queue.length >= queueCap()) {
    metrics.queueFull += 1
    return Promise.reject(new QueueFullError(atsType))
  }
  metrics.queued += 1
  metrics.throttled += 1
  emitCounter("ats_rate_limit.queued", { atsType })
  emitCounter("ats_rate_limit.throttled", { atsType })
  return new Promise<void>((resolve) => {
    b.queue.push(resolve)
    pump(b)
  })
}

/**
 * Run `fn` under the per-host token bucket for `atsType`. Resolves with fn's
 * result once a token is granted. Rejects with QueueFullError if the host's
 * queue is at capacity (before fn runs).
 */
export async function withAtsRateLimit<T>(atsType: AtsHost, fn: () => Promise<T>): Promise<T> {
  await acquire(atsType)
  return fn()
}

/** Snapshot of limiter metrics for the metrics endpoint. */
export function getAtsRateLimiterMetrics(): {
  queued: number
  throttled: number
  acquired: number
  queueFull: number
  perHost: Record<string, { queued: number; tokens: number; rps: number; burst: number }>
} {
  const perHost: Record<string, { queued: number; tokens: number; rps: number; burst: number }> = {}
  for (const [host, b] of buckets) {
    perHost[host] = {
      queued: b.queue.length,
      tokens: Math.floor(b.tokens),
      rps: b.cfg.rps,
      burst: b.cfg.burst,
    }
  }
  return {
    queued: metrics.queued,
    throttled: metrics.throttled,
    acquired: metrics.acquired,
    queueFull: metrics.queueFull,
    perHost,
  }
}

/**
 * Test-only: clear all buckets, cancel pending timers, and reset metrics so a
 * fresh env config takes effect. Not for production use.
 */
export function __resetAtsRateLimiter(): void {
  for (const b of buckets.values()) {
    if (b.timer) clearTimeout(b.timer)
  }
  buckets.clear()
  metrics.queued = 0
  metrics.throttled = 0
  metrics.acquired = 0
  metrics.queueFull = 0
}
