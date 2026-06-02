import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"
import type { SignalApiQuotaState } from "./types"

type QuotaMode = "auto" | "db" | "memory" | "off"

type QuotaPolicy = {
  planName: string
  enforce: boolean
  dailyLimit: number | null
  monthlyLimit: number | null
}

type QuotaConfig = {
  mode: QuotaMode
  defaultPolicy: QuotaPolicy
  dbRetentionDays: number
  dbRetentionMonths: number
  dbUnavailableBackoffSeconds: number
}

type PeriodBoundaries = {
  dayStartMs: number
  nextDayStartMs: number
  monthStartMs: number
  nextMonthStartMs: number
}

type CounterBucket = {
  periodStartMs: number
  requestCount: number
}

const dailyBuckets = new Map<string, CounterBucket>()
const monthlyBuckets = new Map<string, CounterBucket>()

let dbQuotaDisabledUntilMs = 0
let dbQuotaWarningPrinted = false
let dbQuotaSchemaWarningPrinted = false
let lastDbCleanupAtMs = 0
let lastLocalCleanupAtMs = 0

function readPositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(raw ?? "", 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function readBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (!raw) return fallback
  const value = raw.trim().toLowerCase()
  if (["1", "true", "yes", "on"].includes(value)) return true
  if (["0", "false", "no", "off"].includes(value)) return false
  return fallback
}

function readPositiveIntOrNull(raw: string | undefined, fallback: number | null): number | null {
  if (!raw) return fallback
  const normalized = raw.trim().toLowerCase()
  if (!normalized) return fallback
  if (["unlimited", "none", "null", "0", "-1"].includes(normalized)) {
    return null
  }

  const n = Number.parseInt(normalized, 10)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return n
}

function getQuotaMode(): QuotaMode {
  const raw = (process.env.APEX_SIGNAL_API_QUOTA_MODE ?? "auto").trim().toLowerCase()
  if (raw === "db") return "db"
  if (raw === "memory") return "memory"
  if (raw === "off") return "off"
  return "auto"
}

function getSignalApiQuotaConfig(): QuotaConfig {
  const defaultPolicy: QuotaPolicy = {
    planName: process.env.APEX_SIGNAL_API_DEFAULT_PLAN_NAME?.trim() || "starter",
    enforce: readBoolean(process.env.APEX_SIGNAL_API_DEFAULT_QUOTA_ENFORCE, false),
    dailyLimit: readPositiveIntOrNull(process.env.APEX_SIGNAL_API_DEFAULT_DAILY_QUOTA, 50_000),
    monthlyLimit: readPositiveIntOrNull(process.env.APEX_SIGNAL_API_DEFAULT_MONTHLY_QUOTA, 1_000_000),
  }

  return {
    mode: getQuotaMode(),
    defaultPolicy,
    dbRetentionDays: readPositiveInt(process.env.APEX_SIGNAL_API_QUOTA_DB_RETENTION_DAYS, 120),
    dbRetentionMonths: readPositiveInt(process.env.APEX_SIGNAL_API_QUOTA_DB_RETENTION_MONTHS, 24),
    dbUnavailableBackoffSeconds: readPositiveInt(
      process.env.APEX_SIGNAL_API_QUOTA_DB_BACKOFF_SECONDS,
      60
    ),
  }
}

function getUtcBoundaries(nowMs: number): PeriodBoundaries {
  const now = new Date(nowMs)
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth()
  const day = now.getUTCDate()

  const dayStartMs = Date.UTC(year, month, day)
  const nextDayStartMs = dayStartMs + 86_400_000
  const monthStartMs = Date.UTC(year, month, 1)
  const nextMonthStartMs = Date.UTC(year, month + 1, 1)

  return { dayStartMs, nextDayStartMs, monthStartMs, nextMonthStartMs }
}

function toIsoDate(utcMs: number): string {
  return new Date(utcMs).toISOString().slice(0, 10)
}

function toPositiveIntOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value)
  }
  if (typeof value === "string") {
    const n = Number.parseInt(value, 10)
    if (Number.isFinite(n) && n > 0) return n
  }
  return null
}

function toCount(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.floor(value)
  }
  if (typeof value === "string") {
    const n = Number.parseInt(value, 10)
    if (Number.isFinite(n) && n >= 0) return n
  }
  return 0
}

function buildQuotaState(
  policy: QuotaPolicy,
  dailyUsed: number,
  monthlyUsed: number,
  boundaries: PeriodBoundaries,
  allowed: boolean
): SignalApiQuotaState {
  const dailyLimit = policy.dailyLimit
  const monthlyLimit = policy.monthlyLimit
  const dailyRemaining = dailyLimit == null ? null : Math.max(0, dailyLimit - dailyUsed)
  const monthlyRemaining = monthlyLimit == null ? null : Math.max(0, monthlyLimit - monthlyUsed)

  return {
    planName: policy.planName,
    enforce: policy.enforce,
    dailyLimit,
    dailyUsed,
    dailyRemaining,
    dailyReset: Math.floor(boundaries.nextDayStartMs / 1000),
    monthlyLimit,
    monthlyUsed,
    monthlyRemaining,
    monthlyReset: Math.floor(boundaries.nextMonthStartMs / 1000),
    allowed,
  }
}

function markDbQuotaUnavailable(backoffSeconds: number): void {
  dbQuotaDisabledUntilMs = Date.now() + backoffSeconds * 1000
}

function shouldUseDbQuota(mode: QuotaMode): boolean {
  if (mode === "memory" || mode === "off") return false
  if (!hasPostgresEnv()) return false
  return Date.now() >= dbQuotaDisabledUntilMs
}

function isDbQuotaSchemaError(error: unknown): boolean {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? (error as { code?: string }).code
      : null
  return code === "42P01" || code === "42703"
}

function isDbQuotaInvalidInputError(error: unknown): boolean {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? (error as { code?: string }).code
      : null
  return code === "22P02"
}

function maybeCleanupLocalBuckets(nowMs: number, boundaries: PeriodBoundaries): void {
  if (nowMs - lastLocalCleanupAtMs < 60_000) return
  if (Math.random() > 0.01) return
  lastLocalCleanupAtMs = nowMs

  for (const [key, bucket] of dailyBuckets.entries()) {
    if (bucket.periodStartMs < boundaries.dayStartMs - 2 * 86_400_000) {
      dailyBuckets.delete(key)
    }
  }

  for (const [key, bucket] of monthlyBuckets.entries()) {
    if (bucket.periodStartMs < boundaries.monthStartMs - 90 * 86_400_000) {
      monthlyBuckets.delete(key)
    }
  }
}

function consumeLocalQuota(
  tenantId: string,
  nowMs: number,
  policy: QuotaPolicy
): SignalApiQuotaState {
  const boundaries = getUtcBoundaries(nowMs)
  const dayKey = `${tenantId}:d:${boundaries.dayStartMs}`
  const monthKey = `${tenantId}:m:${boundaries.monthStartMs}`

  const dailyUsedBefore = dailyBuckets.get(dayKey)?.requestCount ?? 0
  const monthlyUsedBefore = monthlyBuckets.get(monthKey)?.requestCount ?? 0

  let allowed = true
  if (policy.enforce && policy.dailyLimit != null && dailyUsedBefore >= policy.dailyLimit) {
    allowed = false
  }
  if (policy.enforce && policy.monthlyLimit != null && monthlyUsedBefore >= policy.monthlyLimit) {
    allowed = false
  }

  const dailyUsed = allowed ? dailyUsedBefore + 1 : dailyUsedBefore
  const monthlyUsed = allowed ? monthlyUsedBefore + 1 : monthlyUsedBefore

  if (allowed) {
    dailyBuckets.set(dayKey, {
      periodStartMs: boundaries.dayStartMs,
      requestCount: dailyUsed,
    })
    monthlyBuckets.set(monthKey, {
      periodStartMs: boundaries.monthStartMs,
      requestCount: monthlyUsed,
    })
  }

  maybeCleanupLocalBuckets(nowMs, boundaries)
  return buildQuotaState(policy, dailyUsed, monthlyUsed, boundaries, allowed)
}

async function maybeCleanupDbUsage(
  dayStartMs: number,
  monthStartMs: number,
  retentionDays: number,
  retentionMonths: number
): Promise<void> {
  const nowMs = Date.now()
  if (nowMs - lastDbCleanupAtMs < 60_000) return
  if (Math.random() > 0.01) return
  lastDbCleanupAtMs = nowMs

  const minDaily = toIsoDate(dayStartMs - retentionDays * 86_400_000)
  const monthStart = new Date(monthStartMs)
  const minMonthly = toIsoDate(
    Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() - retentionMonths, 1)
  )

  const pool = getPostgresPool()
  await pool.query(
    `DELETE FROM signal_api_quota_daily_usage
     WHERE day_start < $1::date`,
    [minDaily]
  )
  await pool.query(
    `DELETE FROM signal_api_quota_monthly_usage
     WHERE month_start < $1::date`,
    [minMonthly]
  )
}

type QuotaPolicyRow = {
  plan_name: string | null
  enforce: boolean | null
  daily_limit: number | string | null
  monthly_limit: number | string | null
}

async function consumeDbQuota(
  tenantId: string,
  nowMs: number,
  config: QuotaConfig
): Promise<SignalApiQuotaState | null> {
  const pool = getPostgresPool()
  const client = await pool.connect()
  const boundaries = getUtcBoundaries(nowMs)
  const dayStart = toIsoDate(boundaries.dayStartMs)
  const monthStart = toIsoDate(boundaries.monthStartMs)

  try {
    await client.query("BEGIN")

    const policyRes = await client.query<QuotaPolicyRow>(
      `SELECT plan_name, enforce, daily_limit, monthly_limit
       FROM signal_api_tenant_quotas
       WHERE tenant_id = $1::text
       LIMIT 1`,
      [tenantId]
    )

    const policyRow = policyRes.rows[0]
    const policy: QuotaPolicy = policyRow
      ? {
          planName: policyRow.plan_name?.trim() || config.defaultPolicy.planName,
          enforce:
            typeof policyRow.enforce === "boolean"
              ? policyRow.enforce
              : config.defaultPolicy.enforce,
          dailyLimit: toPositiveIntOrNull(policyRow.daily_limit),
          monthlyLimit: toPositiveIntOrNull(policyRow.monthly_limit),
        }
      : config.defaultPolicy

    await client.query(
      `INSERT INTO signal_api_quota_daily_usage (
         tenant_id,
         day_start,
         request_count,
         created_at,
         updated_at
       ) VALUES ($1::text, $2::date, 0, NOW(), NOW())
       ON CONFLICT (tenant_id, day_start) DO NOTHING`,
      [tenantId, dayStart]
    )

    await client.query(
      `INSERT INTO signal_api_quota_monthly_usage (
         tenant_id,
         month_start,
         request_count,
         created_at,
         updated_at
       ) VALUES ($1::text, $2::date, 0, NOW(), NOW())
       ON CONFLICT (tenant_id, month_start) DO NOTHING`,
      [tenantId, monthStart]
    )

    const dailyCountRes = await client.query<{ request_count: number | string }>(
      `SELECT request_count
       FROM signal_api_quota_daily_usage
       WHERE tenant_id = $1::text
         AND day_start = $2::date
       FOR UPDATE`,
      [tenantId, dayStart]
    )
    const monthlyCountRes = await client.query<{ request_count: number | string }>(
      `SELECT request_count
       FROM signal_api_quota_monthly_usage
       WHERE tenant_id = $1::text
         AND month_start = $2::date
       FOR UPDATE`,
      [tenantId, monthStart]
    )

    const dailyUsedBefore = toCount(dailyCountRes.rows[0]?.request_count)
    const monthlyUsedBefore = toCount(monthlyCountRes.rows[0]?.request_count)

    let allowed = true
    if (policy.enforce && policy.dailyLimit != null && dailyUsedBefore >= policy.dailyLimit) {
      allowed = false
    }
    if (policy.enforce && policy.monthlyLimit != null && monthlyUsedBefore >= policy.monthlyLimit) {
      allowed = false
    }

    let dailyUsed = dailyUsedBefore
    let monthlyUsed = monthlyUsedBefore

    if (allowed) {
      const nextDailyRes = await client.query<{ request_count: number | string }>(
        `UPDATE signal_api_quota_daily_usage
         SET request_count = request_count + 1,
             updated_at = NOW()
         WHERE tenant_id = $1::text
           AND day_start = $2::date
         RETURNING request_count`,
        [tenantId, dayStart]
      )

      const nextMonthlyRes = await client.query<{ request_count: number | string }>(
        `UPDATE signal_api_quota_monthly_usage
         SET request_count = request_count + 1,
             updated_at = NOW()
         WHERE tenant_id = $1::text
           AND month_start = $2::date
         RETURNING request_count`,
        [tenantId, monthStart]
      )

      dailyUsed = toCount(nextDailyRes.rows[0]?.request_count)
      monthlyUsed = toCount(nextMonthlyRes.rows[0]?.request_count)
      await client.query("COMMIT")
    } else {
      await client.query("ROLLBACK")
    }

    void maybeCleanupDbUsage(
      boundaries.dayStartMs,
      boundaries.monthStartMs,
      config.dbRetentionDays,
      config.dbRetentionMonths
    ).catch((error) => {
      if (isDbQuotaSchemaError(error)) return
      console.error("[signal-api] quota cleanup failed", error)
    })

    return buildQuotaState(policy, dailyUsed, monthlyUsed, boundaries, allowed)
  } catch (error) {
    try {
      await client.query("ROLLBACK")
    } catch {
      // no-op
    }

    markDbQuotaUnavailable(config.dbUnavailableBackoffSeconds)

    if (isDbQuotaSchemaError(error)) {
      if (!dbQuotaSchemaWarningPrinted) {
        dbQuotaSchemaWarningPrinted = true
        console.warn(
          "[signal-api] quota tables missing; run scripts/migrations/add-signal-api-quotas.sql"
        )
      }
      return null
    }

    if (!dbQuotaWarningPrinted && !isDbQuotaInvalidInputError(error)) {
      dbQuotaWarningPrinted = true
      console.warn("[signal-api] falling back to memory quota limiter")
    }

    if (isDbQuotaInvalidInputError(error)) {
      // Bad tenant ids should not make auth fail hard.
      return null
    }

    return null
  } finally {
    client.release()
  }
}

function offQuotaState(policy: QuotaPolicy, nowMs: number): SignalApiQuotaState {
  const boundaries = getUtcBoundaries(nowMs)
  return buildQuotaState(policy, 0, 0, boundaries, true)
}

export async function consumeSignalApiQuota(tenantId: string): Promise<SignalApiQuotaState> {
  const nowMs = Date.now()
  const config = getSignalApiQuotaConfig()

  if (config.mode === "off") {
    return offQuotaState(
      {
        ...config.defaultPolicy,
        enforce: false,
      },
      nowMs
    )
  }

  if (shouldUseDbQuota(config.mode)) {
    const distributed = await consumeDbQuota(tenantId, nowMs, config)
    if (distributed) return distributed
  }

  return consumeLocalQuota(tenantId, nowMs, config.defaultPolicy)
}
