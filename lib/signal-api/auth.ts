import { randomUUID, timingSafeEqual } from "crypto"
import { NextResponse } from "next/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { consumeSignalApiRateLimit } from "./rate-limit"
import { consumeSignalApiQuota } from "./quota"
import { signalApiError } from "./http"
import type { SignalApiAuthContext, SignalApiEnvKey } from "./types"
import { sha256Hex } from "./key-material"

type RequireSignalApiAuthOptions = {
  requiredScopes?: string[]
  requireUser?: boolean
}

type ResolvedKey = {
  apiKeyId: string
  tenantId: string
  scopes: string[]
  defaultUserId: string | null
  source: "env" | "db"
}

type RequireSignalApiAuthResult = SignalApiAuthContext | NextResponse
type ResolvedSubjectUser = {
  userId: string | null
  conflictWithDefault: boolean
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

let cachedEnvKeys: SignalApiEnvKey[] | null = null

function parseScopeList(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw
      .filter((v): v is string => typeof v === "string")
      .map((v) => v.trim())
      .filter(Boolean)
  }
  if (typeof raw === "string") {
    return raw
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean)
  }
  return []
}

function readEnvApiKeys(): SignalApiEnvKey[] {
  if (cachedEnvKeys) return cachedEnvKeys

  const keys: SignalApiEnvKey[] = []
  const defaultTenant = process.env.APEX_SIGNAL_API_DEFAULT_TENANT_ID?.trim() || "default"

  const singleKey = process.env.APEX_SIGNAL_API_KEY?.trim()
  if (singleKey) {
    keys.push({
      key: singleKey,
      keyId: process.env.APEX_SIGNAL_API_KEY_ID?.trim() || "env_primary",
      tenantId: defaultTenant,
      scopes: parseScopeList(process.env.APEX_SIGNAL_API_SCOPES),
      defaultUserId: process.env.APEX_SIGNAL_API_DEFAULT_USER_ID?.trim() || undefined,
    })
  }

  const raw = process.env.APEX_SIGNAL_API_KEYS_JSON?.trim()
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (!item || typeof item !== "object") continue
          const rec = item as Record<string, unknown>
          const key = typeof rec.key === "string" ? rec.key.trim() : ""
          const tenantId = typeof rec.tenantId === "string" ? rec.tenantId.trim() : ""
          if (!key || !tenantId) continue
          keys.push({
            key,
            tenantId,
            keyId: typeof rec.keyId === "string" ? rec.keyId.trim() : undefined,
            scopes: parseScopeList(rec.scopes),
            defaultUserId:
              typeof rec.defaultUserId === "string" ? rec.defaultUserId.trim() : undefined,
            disabled: rec.disabled === true,
          })
        }
      }
    } catch (error) {
      console.error("[signal-api] invalid APEX_SIGNAL_API_KEYS_JSON", error)
    }
  }

  cachedEnvKeys = keys
  return keys
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a)
  const bBuf = Buffer.from(b)
  if (aBuf.length !== bBuf.length) return false
  return timingSafeEqual(aBuf, bBuf)
}

function resolveFromEnv(rawKey: string): ResolvedKey | null {
  const keys = readEnvApiKeys()
  for (const item of keys) {
    if (item.disabled) continue
    if (!timingSafeStringEqual(item.key, rawKey)) continue
    return {
      apiKeyId: item.keyId || `env_${sha256Hex(item.key).slice(0, 12)}`,
      tenantId: item.tenantId,
      scopes: parseScopeList(item.scopes),
      defaultUserId: item.defaultUserId ?? null,
      source: "env",
    }
  }
  return null
}

function toText(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

async function resolveFromDatabase(rawKey: string): Promise<ResolvedKey | null> {
  const pool = getPostgresPool()
  const keyHash = sha256Hex(rawKey)

  try {
    const result = await pool.query<Record<string, unknown>>(
      `SELECT
         id::text AS id,
         tenant_id::text AS tenant_id,
         default_user_id::text AS default_user_id,
         scopes AS scopes
       FROM signal_api_keys
       WHERE key_hash = $1
         AND is_active = true
         AND (expires_at IS NULL OR expires_at > NOW())
       LIMIT 1`,
      [keyHash]
    )

    const row = result.rows[0]
    if (!row) return null

    const id = toText(row.id)
    const tenantId = toText(row.tenant_id)
    if (!id || !tenantId) return null

    return {
      apiKeyId: id,
      tenantId,
      defaultUserId: toText(row.default_user_id),
      scopes: parseScopeList(row.scopes),
      source: "db",
    }
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: string }).code
        : null

    // Missing table/columns in environments where signal_api_keys is not created yet.
    if (code === "42P01" || code === "42703") return null
    throw error
  }
}

async function touchDatabaseKeyUsage(apiKeyId: string): Promise<void> {
  const pool = getPostgresPool()
  try {
    await pool.query(
      `UPDATE signal_api_keys
       SET last_used_at = NOW(),
           usage_count = usage_count + 1
       WHERE id = $1::uuid`,
      [apiKeyId]
    )
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: string }).code
        : null
    if (code === "42P01" || code === "42703") return
    console.error("[signal-api] failed to update key usage", error)
  }
}

function resolveSubjectUserId(request: Request, defaultUserId: string | null): ResolvedSubjectUser {
  const fromHeader = request.headers.get("x-apex-user-id")?.trim() || null
  const headerUserId = fromHeader && UUID_RE.test(fromHeader) ? fromHeader : null
  const normalizedDefaultUserId =
    defaultUserId && UUID_RE.test(defaultUserId) ? defaultUserId : null

  if (normalizedDefaultUserId) {
    if (headerUserId && headerUserId !== normalizedDefaultUserId) {
      return {
        userId: null,
        conflictWithDefault: true,
      }
    }
    return {
      userId: normalizedDefaultUserId,
      conflictWithDefault: false,
    }
  }

  return {
    userId: headerUserId,
    conflictWithDefault: false,
  }
}

async function isTenantUserAllowed(tenantId: string, userId: string): Promise<boolean> {
  const pool = getPostgresPool()
  try {
    const result = await pool.query<{ has_members: boolean; is_member: boolean }>(
      `SELECT
         EXISTS(
           SELECT 1
           FROM signal_api_tenant_users
           WHERE tenant_id = $1::text
         ) AS has_members,
         EXISTS(
           SELECT 1
           FROM signal_api_tenant_users
           WHERE tenant_id = $1::text
             AND user_id = $2::uuid
         ) AS is_member`,
      [tenantId, userId]
    )

    const row = result.rows[0]
    if (!row) return true
    if (!row.has_members) return true
    return row.is_member
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: string }).code
        : null
    if (code === "42P01" || code === "42703") return true
    throw error
  }
}

function hasRequiredScopes(scopes: string[], requiredScopes: string[]): boolean {
  if (requiredScopes.length === 0) return true
  if (scopes.length === 0) return true
  const have = new Set(scopes)
  return requiredScopes.every((s) => have.has(s))
}

export async function requireSignalApiAuth(
  request: Request,
  options: RequireSignalApiAuthOptions = {}
): Promise<RequireSignalApiAuthResult> {
  const requestId = randomUUID()
  const rawKey = request.headers.get("x-api-key")?.trim()

  if (!rawKey) {
    return signalApiError(401, "Missing API key", "UNAUTHORIZED", requestId)
  }

  let key =
    resolveFromEnv(rawKey) ??
    (await resolveFromDatabase(rawKey))

  if (!key) {
    return signalApiError(401, "Invalid API key", "UNAUTHORIZED", requestId)
  }

  const rateLimit = await consumeSignalApiRateLimit(key.apiKeyId)
  if (!rateLimit.allowed) {
    return signalApiError(429, "Rate limit exceeded", "RATE_LIMITED", requestId, rateLimit)
  }

  const requiredScopes = options.requiredScopes ?? []
  if (!hasRequiredScopes(key.scopes, requiredScopes)) {
    return signalApiError(
      403,
      "API key lacks required scope",
      "FORBIDDEN",
      requestId,
      rateLimit,
      { requiredScopes }
    )
  }

  const subjectUser = resolveSubjectUserId(request, key.defaultUserId)
  if (subjectUser.conflictWithDefault) {
    return signalApiError(
      403,
      "x-apex-user-id does not match the API key default user",
      "FORBIDDEN",
      requestId,
      rateLimit
    )
  }

  const subjectUserId = subjectUser.userId
  if (options.requireUser && !subjectUserId) {
    return signalApiError(
      400,
      "x-apex-user-id is required for user-scoped endpoints",
      "BAD_REQUEST",
      requestId,
      rateLimit
    )
  }

  if (subjectUserId) {
    const isAllowed = await isTenantUserAllowed(key.tenantId, subjectUserId)
    if (!isAllowed) {
      return signalApiError(
        403,
        "User is not allowed for this tenant",
        "FORBIDDEN",
        requestId,
        rateLimit
      )
    }
  }

  const quota = await consumeSignalApiQuota(key.tenantId)
  if (!quota.allowed) {
    return signalApiError(
      429,
      "Plan quota exceeded",
      "QUOTA_EXCEEDED",
      requestId,
      rateLimit,
      {
        planName: quota.planName,
        dailyLimit: quota.dailyLimit,
        dailyUsed: quota.dailyUsed,
        monthlyLimit: quota.monthlyLimit,
        monthlyUsed: quota.monthlyUsed,
      },
      quota
    )
  }

  if (key.source === "db") {
    void touchDatabaseKeyUsage(key.apiKeyId)
  }

  return {
    requestId,
    apiKeyId: key.apiKeyId,
    tenantId: key.tenantId,
    scopes: key.scopes,
    subjectUserId,
    rateLimit,
    quota,
  }
}
