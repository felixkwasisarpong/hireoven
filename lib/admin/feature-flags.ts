/**
 * Server-side feature-flag accessors backed by `system_settings`.
 *
 * Two flags are exposed today:
 *   - payments_disabled — when true, /api/stripe/checkout and interview
 *     credit purchases return 503 and upgrade CTAs hide across the UI.
 *     Existing Pro subscriptions keep flowing via the webhook + portal —
 *     the kill switch only stops *new* checkouts.
 *   - maintenance_banner — when enabled, the landing page renders a top
 *     banner with the configured message.
 *
 * Cached in-process for FLAG_CACHE_TTL_MS to avoid hammering Postgres on
 * hot paths (every server-rendered page reads at least one flag).
 */
import { getPostgresPool } from "@/lib/postgres/server"

export type PaymentsDisabledValue = {
  enabled: boolean
  message?: string
}

export type MaintenanceBannerValue = {
  enabled: boolean
  message: string
}

export type FeatureFlagsSnapshot = {
  paymentsDisabled: PaymentsDisabledValue
  maintenanceBanner: MaintenanceBannerValue
}

export const FEATURE_FLAG_KEYS = {
  paymentsDisabled: "payments_disabled",
  maintenanceBanner: "maintenance_banner",
} as const

const DEFAULTS: FeatureFlagsSnapshot = {
  paymentsDisabled: { enabled: false },
  maintenanceBanner: { enabled: false, message: "" },
}

const FLAG_CACHE_TTL_MS = 30_000

type CacheEntry = {
  value: FeatureFlagsSnapshot
  expiresAt: number
}

const globalForCache = globalThis as typeof globalThis & {
  _featureFlagsCache?: CacheEntry
}

function isPaymentsDisabledValue(value: unknown): value is PaymentsDisabledValue {
  return typeof value === "object" && value !== null && typeof (value as { enabled?: unknown }).enabled === "boolean"
}

function isMaintenanceBannerValue(value: unknown): value is MaintenanceBannerValue {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { enabled?: unknown }).enabled === "boolean" &&
    typeof (value as { message?: unknown }).message === "string"
  )
}

async function loadFeatureFlagsFromDb(): Promise<FeatureFlagsSnapshot> {
  try {
    const pool = getPostgresPool()
    const { rows } = await pool.query<{ key: string; value: unknown }>(
      `SELECT key, value FROM system_settings WHERE key = ANY($1::text[])`,
      [[FEATURE_FLAG_KEYS.paymentsDisabled, FEATURE_FLAG_KEYS.maintenanceBanner]],
    )

    const byKey = new Map(rows.map((row) => [row.key, row.value]))
    const paymentsRaw = byKey.get(FEATURE_FLAG_KEYS.paymentsDisabled)
    const bannerRaw = byKey.get(FEATURE_FLAG_KEYS.maintenanceBanner)

    return {
      paymentsDisabled: isPaymentsDisabledValue(paymentsRaw)
        ? paymentsRaw
        : DEFAULTS.paymentsDisabled,
      maintenanceBanner: isMaintenanceBannerValue(bannerRaw)
        ? bannerRaw
        : DEFAULTS.maintenanceBanner,
    }
  } catch {
    return DEFAULTS
  }
}

export async function getFeatureFlags(): Promise<FeatureFlagsSnapshot> {
  const cached = globalForCache._featureFlagsCache
  if (cached && cached.expiresAt > Date.now()) return cached.value

  const fresh = await loadFeatureFlagsFromDb()
  globalForCache._featureFlagsCache = {
    value: fresh,
    expiresAt: Date.now() + FLAG_CACHE_TTL_MS,
  }
  return fresh
}

export async function isPaymentsDisabled(): Promise<boolean> {
  const flags = await getFeatureFlags()
  return flags.paymentsDisabled.enabled
}

export async function getMaintenanceBanner(): Promise<MaintenanceBannerValue> {
  const flags = await getFeatureFlags()
  return flags.maintenanceBanner
}

/**
 * Drop the in-process cache. Called by the admin POST handler so toggling
 * a flag takes effect on the next request rather than waiting up to 30s.
 */
export function invalidateFeatureFlagsCache(): void {
  globalForCache._featureFlagsCache = undefined
}
