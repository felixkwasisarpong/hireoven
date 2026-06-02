import { NextRequest, NextResponse } from "next/server"
import { assertAdminAccess } from "@/lib/admin/auth"
import { getPostgresPool } from "@/lib/postgres/server"
import { createSignalApiKey } from "@/lib/signal-api/key-material"

export const runtime = "nodejs"

type SignalApiKeyRow = {
  id: string
  tenant_id: string
  name: string
  key_prefix: string
  scopes: string[] | null
  default_user_id: string | null
  created_by_user_id: string | null
  is_active: boolean
  expires_at: string | null
  last_used_at: string | null
  usage_count: number | string | null
  metadata: unknown
  revoked_at: string | null
  created_at: string | null
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function normalizeScopes(value: unknown): string[] | null {
  if (value === undefined || value === null) return []
  if (Array.isArray(value)) {
    return [...new Set(value
      .filter((v): v is string => typeof v === "string")
      .map((v) => v.trim())
      .filter(Boolean))]
  }
  if (typeof value === "string") {
    return [...new Set(value
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean))]
  }
  return null
}

function usageCountToNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed) && parsed >= 0) return parsed
  }
  return 0
}

function parseExpiresAt(value: unknown): string | null | "invalid" {
  if (value === undefined) return null
  if (value === null) return null
  if (typeof value !== "string") return "invalid"
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = new Date(trimmed)
  if (!Number.isFinite(parsed.getTime())) return "invalid"
  return parsed.toISOString()
}

function serializeKey(row: SignalApiKeyRow) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    keyPrefix: row.key_prefix,
    scopes: row.scopes ?? [],
    defaultUserId: row.default_user_id,
    createdByUserId: row.created_by_user_id,
    isActive: row.is_active,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
    usageCount: usageCountToNumber(row.usage_count),
    metadata: row.metadata,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
  }
}

function handleKnownErrors(error: unknown): NextResponse | null {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? (error as { code?: string }).code
      : null

  if (code === "42P01" || code === "42703") {
    return NextResponse.json(
      {
        error: "signal_api_keys table is missing",
        hint: "Run scripts/migrations/add-signal-api-keys.sql",
      },
      { status: 503 }
    )
  }

  if (code === "22P02") {
    return NextResponse.json({ error: "Invalid key id" }, { status: 400 })
  }

  return null
}

const BASE_SELECT = `RETURNING
  id::text,
  tenant_id,
  name,
  key_prefix,
  scopes,
  default_user_id::text,
  created_by_user_id::text,
  is_active,
  expires_at::text,
  last_used_at::text,
  usage_count,
  metadata,
  revoked_at::text,
  created_at::text`

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const access = await assertAdminAccess()
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const { id } = await params
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const action = typeof body.action === "string" ? body.action : ""

  if (!action) {
    return NextResponse.json({ error: "action is required" }, { status: 400 })
  }

  const pool = getPostgresPool()

  try {
    if (action === "revoke") {
      const result = await pool.query<SignalApiKeyRow>(
        `UPDATE signal_api_keys
         SET is_active = false,
             revoked_at = NOW()
         WHERE id = $1::uuid
         ${BASE_SELECT}`,
        [id]
      )

      if (!result.rows[0]) return NextResponse.json({ error: "Not found" }, { status: 404 })
      return NextResponse.json({ key: serializeKey(result.rows[0]) })
    }

    if (action === "reactivate") {
      const result = await pool.query<SignalApiKeyRow>(
        `UPDATE signal_api_keys
         SET is_active = true,
             revoked_at = NULL
         WHERE id = $1::uuid
         ${BASE_SELECT}`,
        [id]
      )

      if (!result.rows[0]) return NextResponse.json({ error: "Not found" }, { status: 404 })
      return NextResponse.json({ key: serializeKey(result.rows[0]) })
    }

    if (action === "rotate") {
      const { rawKey, keyHash, keyPrefix } = createSignalApiKey()

      const result = await pool.query<SignalApiKeyRow>(
        `UPDATE signal_api_keys
         SET key_hash = $2,
             key_prefix = $3,
             is_active = true,
             revoked_at = NULL,
             last_used_at = NULL,
             usage_count = 0,
             metadata = COALESCE(metadata, '{}'::jsonb)
               || jsonb_build_object('lastRotatedAt', NOW(), 'lastRotatedByUserId', $4::text)
         WHERE id = $1::uuid
         ${BASE_SELECT}`,
        [id, keyHash, keyPrefix, access.profile.id]
      )

      if (!result.rows[0]) return NextResponse.json({ error: "Not found" }, { status: 404 })

      return NextResponse.json({
        apiKey: rawKey,
        key: serializeKey(result.rows[0]),
      })
    }

    if (action === "update") {
      const values: unknown[] = []
      const setClauses: string[] = []

      if ("name" in body) {
        if (typeof body.name !== "string" || !body.name.trim()) {
          return NextResponse.json({ error: "name must be a non-empty string" }, { status: 400 })
        }
        values.push(body.name.trim())
        setClauses.push(`name = $${values.length}`)
      }

      if ("scopes" in body) {
        const scopes = normalizeScopes(body.scopes)
        if (!scopes) {
          return NextResponse.json(
            { error: "scopes must be an array or comma-separated string" },
            { status: 400 }
          )
        }
        values.push(scopes)
        setClauses.push(`scopes = $${values.length}::text[]`)
      }

      if ("defaultUserId" in body) {
        const defaultUserIdRaw = body.defaultUserId
        if (
          defaultUserIdRaw !== null &&
          (typeof defaultUserIdRaw !== "string" || (defaultUserIdRaw.trim() && !UUID_RE.test(defaultUserIdRaw.trim())))
        ) {
          return NextResponse.json({ error: "defaultUserId must be a UUID string or null" }, { status: 400 })
        }

        const defaultUserId = typeof defaultUserIdRaw === "string" ? defaultUserIdRaw.trim() || null : null
        values.push(defaultUserId)
        setClauses.push(`default_user_id = $${values.length}::uuid`)
      }

      if ("expiresAt" in body) {
        const expiresAt = parseExpiresAt(body.expiresAt)
        if (expiresAt === "invalid") {
          return NextResponse.json(
            { error: "expiresAt must be a valid ISO date string or null" },
            { status: 400 }
          )
        }
        values.push(expiresAt)
        setClauses.push(`expires_at = $${values.length}::timestamptz`)
      }

      if ("metadata" in body) {
        const metadata = body.metadata
        if (metadata === null || Array.isArray(metadata) || typeof metadata !== "object") {
          return NextResponse.json({ error: "metadata must be an object" }, { status: 400 })
        }
        values.push(JSON.stringify(metadata))
        setClauses.push(`metadata = $${values.length}::jsonb`)
      }

      if ("isActive" in body) {
        if (typeof body.isActive !== "boolean") {
          return NextResponse.json({ error: "isActive must be a boolean" }, { status: 400 })
        }
        values.push(body.isActive)
        setClauses.push(`is_active = $${values.length}`)
        setClauses.push(
          body.isActive
            ? "revoked_at = NULL"
            : "revoked_at = NOW()"
        )
      }

      if (setClauses.length === 0) {
        return NextResponse.json({ error: "No valid fields to update" }, { status: 400 })
      }

      values.push(id)
      const result = await pool.query<SignalApiKeyRow>(
        `UPDATE signal_api_keys
         SET ${setClauses.join(", ")}
         WHERE id = $${values.length}::uuid
         ${BASE_SELECT}`,
        values
      )

      if (!result.rows[0]) return NextResponse.json({ error: "Not found" }, { status: 404 })
      return NextResponse.json({ key: serializeKey(result.rows[0]) })
    }

    return NextResponse.json(
      { error: "Unknown action. Use revoke, reactivate, rotate, or update." },
      { status: 400 }
    )
  } catch (error) {
    const knownError = handleKnownErrors(error)
    if (knownError) return knownError
    return NextResponse.json({ error: (error as Error).message }, { status: 500 })
  }
}
