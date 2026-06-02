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

function handleMissingTable(error: unknown): NextResponse | null {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? (error as { code?: string }).code
      : null

  if (code !== "42P01" && code !== "42703") return null

  return NextResponse.json(
    {
      error: "signal_api_keys table is missing",
      hint: "Run scripts/migrations/add-signal-api-keys.sql",
    },
    { status: 503 }
  )
}

export async function GET(request: NextRequest) {
  const access = await assertAdminAccess()
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const tenantId = request.nextUrl.searchParams.get("tenantId")?.trim() || null
  const includeInactive = request.nextUrl.searchParams.get("includeInactive") !== "false"

  const pool = getPostgresPool()
  try {
    const result = await pool.query<SignalApiKeyRow>(
      `SELECT
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
         created_at::text
       FROM signal_api_keys
       WHERE ($1::text IS NULL OR tenant_id = $1::text)
         AND ($2::boolean = true OR is_active = true)
       ORDER BY created_at DESC
       LIMIT 500`,
      [tenantId, includeInactive]
    )

    return NextResponse.json({
      keys: result.rows.map(serializeKey),
    })
  } catch (error) {
    const missingTable = handleMissingTable(error)
    if (missingTable) return missingTable
    return NextResponse.json({ error: (error as Error).message }, { status: 500 })
  }
}

type CreateBody = {
  tenantId?: unknown
  name?: unknown
  scopes?: unknown
  defaultUserId?: unknown
  expiresAt?: unknown
  expiresDays?: unknown
  metadata?: unknown
}

export async function POST(request: NextRequest) {
  const access = await assertAdminAccess()
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const body = (await request.json().catch(() => ({}))) as CreateBody
  const tenantId = typeof body.tenantId === "string" ? body.tenantId.trim() : ""
  const name = typeof body.name === "string" ? body.name.trim() : ""

  if (!tenantId) return NextResponse.json({ error: "tenantId is required" }, { status: 400 })
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 })

  const scopes = normalizeScopes(body.scopes)
  if (!scopes) {
    return NextResponse.json({ error: "scopes must be an array or comma-separated string" }, { status: 400 })
  }

  const defaultUserId =
    body.defaultUserId === undefined
      ? null
      : typeof body.defaultUserId === "string"
        ? body.defaultUserId.trim() || null
        : body.defaultUserId === null
          ? null
          : undefined
  if (defaultUserId === undefined) {
    return NextResponse.json({ error: "defaultUserId must be a string or null" }, { status: 400 })
  }
  if (defaultUserId && !UUID_RE.test(defaultUserId)) {
    return NextResponse.json({ error: "defaultUserId must be a valid UUID" }, { status: 400 })
  }

  const expiresAt = parseExpiresAt(body.expiresAt)
  if (expiresAt === "invalid") {
    return NextResponse.json({ error: "expiresAt must be a valid ISO date string or null" }, { status: 400 })
  }

  const expiresDays =
    typeof body.expiresDays === "number" && Number.isFinite(body.expiresDays)
      ? Math.floor(body.expiresDays)
      : null
  const resolvedExpiresAt =
    expiresAt ??
    (expiresDays && expiresDays > 0
      ? new Date(Date.now() + expiresDays * 86_400_000).toISOString()
      : null)

  const metadata =
    body.metadata === undefined ? {} : body.metadata
  if (metadata === null || Array.isArray(metadata) || typeof metadata !== "object") {
    return NextResponse.json({ error: "metadata must be an object" }, { status: 400 })
  }

  const { rawKey, keyHash, keyPrefix } = createSignalApiKey()
  const pool = getPostgresPool()

  try {
    const result = await pool.query<SignalApiKeyRow>(
      `INSERT INTO signal_api_keys (
         tenant_id,
         name,
         key_hash,
         key_prefix,
         scopes,
         default_user_id,
         created_by_user_id,
         expires_at,
         metadata
       ) VALUES (
         $1,
         $2,
         $3,
         $4,
         $5::text[],
         $6::uuid,
         $7::uuid,
         $8::timestamptz,
         $9::jsonb
       )
       RETURNING
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
         created_at::text`,
      [
        tenantId,
        name,
        keyHash,
        keyPrefix,
        scopes,
        defaultUserId,
        access.profile.id,
        resolvedExpiresAt,
        JSON.stringify(metadata),
      ]
    )

    return NextResponse.json(
      {
        apiKey: rawKey,
        key: serializeKey(result.rows[0]),
      },
      { status: 201 }
    )
  } catch (error) {
    const missingTable = handleMissingTable(error)
    if (missingTable) return missingTable
    return NextResponse.json({ error: (error as Error).message }, { status: 500 })
  }
}
