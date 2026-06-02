import type { SignalApiRateLimitState } from "./types"
import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"

type WindowBucket = {
  windowStart: number
  count: number
}

const buckets = new Map<string, WindowBucket>()
let dbLimiterDisabledUntilMs = 0
let dbLimiterWarningPrinted = false
let lastDbCleanupAtMs = 0

function readPositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(raw ?? "", 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

type RateLimitMode = "auto" | "db" | "memory"

function getRateLimitMode(): RateLimitMode {
  const raw = (process.env.APEX_SIGNAL_API_RATE_LIMIT_MODE ?? "auto").trim().toLowerCase()
  if (raw === "db") return "db"
  if (raw === "memory") return "memory"
  return "auto"
}

export function getSignalApiRateLimitConfig() {
  const limit = readPositiveInt(process.env.APEX_SIGNAL_API_RATE_LIMIT, 300)
  const windowSeconds = readPositiveInt(process.env.APEX_SIGNAL_API_RATE_LIMIT_WINDOW_SECONDS, 3600)
  const dbRetentionWindows = readPositiveInt(
    process.env.APEX_SIGNAL_API_RATE_LIMIT_DB_RETENTION_WINDOWS,
    48
  )
  const dbUnavailableBackoffSeconds = readPositiveInt(
    process.env.APEX_SIGNAL_API_RATE_LIMIT_DB_BACKOFF_SECONDS,
    60
  )
  return { limit, windowSeconds, dbRetentionWindows, dbUnavailableBackoffSeconds }
}

/**
 * Process-local limiter fallback.
 */
function consumeLocalRateLimit(
  identity: string,
  nowMs: number,
  limit: number,
  windowSeconds: number
): SignalApiRateLimitState {
  const windowMs = windowSeconds * 1000
  const windowStart = Math.floor(nowMs / windowMs) * windowMs
  const key = `${identity}:${windowStart}`
  const existing = buckets.get(key)
  const count = (existing?.count ?? 0) + 1
  buckets.set(key, { windowStart, count })

  const remaining = Math.max(0, limit - count)
  const allowed = count <= limit
  const reset = Math.floor((windowStart + windowMs) / 1000)

  return { limit, remaining, reset, windowSeconds, allowed }
}

function shouldUseDbLimiter(mode: RateLimitMode): boolean {
  if (mode === "memory") return false
  if (!hasPostgresEnv()) return false
  return Date.now() >= dbLimiterDisabledUntilMs
}

function markDbLimiterUnavailable(backoffSeconds: number): void {
  dbLimiterDisabledUntilMs = Date.now() + backoffSeconds * 1000
}

function isDbLimiterSchemaError(error: unknown): boolean {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? (error as { code?: string }).code
      : null
  return code === "42P01" || code === "42703"
}

async function maybeCleanupDbBuckets(
  windowStartEpoch: number,
  windowSeconds: number,
  dbRetentionWindows: number
) {
  const nowMs = Date.now()
  if (nowMs - lastDbCleanupAtMs < 60_000) return
  if (Math.random() > 0.01) return
  lastDbCleanupAtMs = nowMs

  const minWindowStart = windowStartEpoch - windowSeconds * dbRetentionWindows
  const pool = getPostgresPool()
  await pool.query(
    `DELETE FROM signal_api_rate_limit_windows
     WHERE window_start_epoch < $1`,
    [minWindowStart]
  )
}

async function consumeDbRateLimit(
  identity: string,
  nowMs: number,
  limit: number,
  windowSeconds: number,
  dbRetentionWindows: number,
  dbUnavailableBackoffSeconds: number
): Promise<SignalApiRateLimitState | null> {
  const windowStartEpoch = Math.floor(nowMs / (windowSeconds * 1000)) * windowSeconds
  const pool = getPostgresPool()

  try {
    const result = await pool.query<{ request_count: number }>(
      `INSERT INTO signal_api_rate_limit_windows (
         identity,
         window_start_epoch,
         request_count,
         created_at,
         updated_at
       ) VALUES ($1, $2, 1, NOW(), NOW())
       ON CONFLICT (identity, window_start_epoch)
       DO UPDATE
         SET request_count = signal_api_rate_limit_windows.request_count + 1,
             updated_at = NOW()
       RETURNING request_count`,
      [identity, windowStartEpoch]
    )

    const count = result.rows[0]?.request_count ?? 1
    const remaining = Math.max(0, limit - count)
    const allowed = count <= limit
    const reset = windowStartEpoch + windowSeconds

    // Best-effort cleanup, sampled to keep request path cheap.
    void maybeCleanupDbBuckets(windowStartEpoch, windowSeconds, dbRetentionWindows).catch((error) => {
      if (isDbLimiterSchemaError(error)) return
      console.error("[signal-api] db limiter cleanup failed", error)
    })

    return { limit, remaining, reset, windowSeconds, allowed }
  } catch (error) {
    markDbLimiterUnavailable(dbUnavailableBackoffSeconds)

    if (!dbLimiterWarningPrinted) {
      dbLimiterWarningPrinted = true
      console.warn("[signal-api] falling back to memory rate limiter", {
        reason:
          typeof error === "object" && error !== null && "code" in error
            ? (error as { code?: string }).code ?? "unknown"
            : "unknown",
      })
    }

    if (isDbLimiterSchemaError(error)) return null
    return null
  }
}

export async function consumeSignalApiRateLimit(identity: string): Promise<SignalApiRateLimitState> {
  const now = Date.now()
  const {
    limit,
    windowSeconds,
    dbRetentionWindows,
    dbUnavailableBackoffSeconds,
  } = getSignalApiRateLimitConfig()
  const mode = getRateLimitMode()

  if (shouldUseDbLimiter(mode)) {
    const distributed = await consumeDbRateLimit(
      identity,
      now,
      limit,
      windowSeconds,
      dbRetentionWindows,
      dbUnavailableBackoffSeconds
    )
    if (distributed) return distributed
  }

  return consumeLocalRateLimit(identity, now, limit, windowSeconds)
}
