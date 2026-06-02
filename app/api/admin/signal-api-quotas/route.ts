import { NextRequest, NextResponse } from "next/server"
import { assertAdminAccess } from "@/lib/admin/auth"
import { getPostgresPool } from "@/lib/postgres/server"

export const runtime = "nodejs"

type QuotaPolicyRow = {
  tenant_id: string
  plan_name: string
  enforce: boolean
  daily_limit: number | string | null
  monthly_limit: number | string | null
  metadata: unknown
  created_by_user_id: string | null
  updated_by_user_id: string | null
  created_at: string | null
  updated_at: string | null
  daily_used: number | string | null
  monthly_used: number | string | null
}

function toPositiveIntOrNull(value: unknown): number | null | "invalid" {
  if (value === null) return null
  if (value === undefined) return null
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value)
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase()
    if (!normalized) return null
    if (["unlimited", "none", "null", "0", "-1"].includes(normalized)) {
      return null
    }
    const parsed = Number.parseInt(normalized, 10)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return "invalid"
}

function toCount(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.floor(value)
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed) && parsed >= 0) return parsed
  }
  return 0
}

function serializePolicy(row: QuotaPolicyRow) {
  return {
    tenantId: row.tenant_id,
    planName: row.plan_name,
    enforce: row.enforce,
    dailyLimit: row.daily_limit == null ? null : toCount(row.daily_limit),
    monthlyLimit: row.monthly_limit == null ? null : toCount(row.monthly_limit),
    dailyUsed: toCount(row.daily_used),
    monthlyUsed: toCount(row.monthly_used),
    metadata: row.metadata,
    createdByUserId: row.created_by_user_id,
    updatedByUserId: row.updated_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function missingTablesResponse() {
  return NextResponse.json(
    {
      error: "Signal API quota tables are missing",
      hint: "Run scripts/migrations/add-signal-api-quotas.sql",
    },
    { status: 503 }
  )
}

function handleKnownError(error: unknown): NextResponse | null {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? (error as { code?: string }).code
      : null

  if (code === "42P01" || code === "42703") return missingTablesResponse()
  if (code === "22P02") {
    return NextResponse.json({ error: "Invalid tenantId or payload" }, { status: 400 })
  }
  return null
}

async function fetchPolicies(tenantId?: string | null) {
  const pool = getPostgresPool()
  const result = await pool.query<QuotaPolicyRow>(
    `WITH periods AS (
       SELECT
         (NOW() AT TIME ZONE 'UTC')::date AS day_start,
         date_trunc('month', NOW() AT TIME ZONE 'UTC')::date AS month_start
     )
     SELECT
       q.tenant_id,
       q.plan_name,
       q.enforce,
       q.daily_limit,
       q.monthly_limit,
       q.metadata,
       q.created_by_user_id::text,
       q.updated_by_user_id::text,
       q.created_at::text,
       q.updated_at::text,
       COALESCE(d.request_count, 0) AS daily_used,
       COALESCE(m.request_count, 0) AS monthly_used
     FROM signal_api_tenant_quotas q
     CROSS JOIN periods p
     LEFT JOIN signal_api_quota_daily_usage d
       ON d.tenant_id = q.tenant_id
      AND d.day_start = p.day_start
     LEFT JOIN signal_api_quota_monthly_usage m
       ON m.tenant_id = q.tenant_id
      AND m.month_start = p.month_start
     WHERE ($1::text IS NULL OR q.tenant_id = $1::text)
     ORDER BY q.updated_at DESC
     LIMIT 500`,
    [tenantId ?? null]
  )

  return result.rows.map(serializePolicy)
}

export async function GET(request: NextRequest) {
  const access = await assertAdminAccess()
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const tenantId = request.nextUrl.searchParams.get("tenantId")?.trim() || null

  try {
    const policies = await fetchPolicies(tenantId)
    return NextResponse.json({ policies })
  } catch (error) {
    const known = handleKnownError(error)
    if (known) return known
    return NextResponse.json({ error: (error as Error).message }, { status: 500 })
  }
}

type UpsertQuotaBody = {
  tenantId?: unknown
  planName?: unknown
  enforce?: unknown
  dailyLimit?: unknown
  monthlyLimit?: unknown
  metadata?: unknown
}

export async function PUT(request: NextRequest) {
  const access = await assertAdminAccess()
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const body = (await request.json().catch(() => ({}))) as UpsertQuotaBody
  const tenantId = typeof body.tenantId === "string" ? body.tenantId.trim() : ""
  const planName = typeof body.planName === "string" ? body.planName.trim() : "starter"
  const enforce = typeof body.enforce === "boolean" ? body.enforce : true

  if (!tenantId) {
    return NextResponse.json({ error: "tenantId is required" }, { status: 400 })
  }
  if (!planName) {
    return NextResponse.json({ error: "planName is required" }, { status: 400 })
  }

  const dailyLimit = toPositiveIntOrNull(body.dailyLimit)
  if (dailyLimit === "invalid") {
    return NextResponse.json(
      { error: "dailyLimit must be a positive integer, null, or 'unlimited'" },
      { status: 400 }
    )
  }

  const monthlyLimit = toPositiveIntOrNull(body.monthlyLimit)
  if (monthlyLimit === "invalid") {
    return NextResponse.json(
      { error: "monthlyLimit must be a positive integer, null, or 'unlimited'" },
      { status: 400 }
    )
  }

  const metadata = body.metadata ?? {}
  if (metadata === null || Array.isArray(metadata) || typeof metadata !== "object") {
    return NextResponse.json({ error: "metadata must be an object" }, { status: 400 })
  }

  const pool = getPostgresPool()

  try {
    await pool.query(
      `INSERT INTO signal_api_tenant_quotas (
         tenant_id,
         plan_name,
         enforce,
         daily_limit,
         monthly_limit,
         metadata,
         created_by_user_id,
         updated_by_user_id
       ) VALUES (
         $1::text,
         $2::text,
         $3::boolean,
         $4::integer,
         $5::integer,
         $6::jsonb,
         $7::uuid,
         $7::uuid
       )
       ON CONFLICT (tenant_id)
       DO UPDATE SET
         plan_name = EXCLUDED.plan_name,
         enforce = EXCLUDED.enforce,
         daily_limit = EXCLUDED.daily_limit,
         monthly_limit = EXCLUDED.monthly_limit,
         metadata = EXCLUDED.metadata,
         updated_by_user_id = EXCLUDED.updated_by_user_id,
         updated_at = NOW()`,
      [
        tenantId,
        planName,
        enforce,
        dailyLimit,
        monthlyLimit,
        JSON.stringify(metadata),
        access.profile.id,
      ]
    )

    const policies = await fetchPolicies(tenantId)
    return NextResponse.json({ policy: policies[0] ?? null })
  } catch (error) {
    const known = handleKnownError(error)
    if (known) return known
    return NextResponse.json({ error: (error as Error).message }, { status: 500 })
  }
}

type DeleteQuotaBody = {
  tenantId?: unknown
}

export async function DELETE(request: NextRequest) {
  const access = await assertAdminAccess()
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const queryTenantId = request.nextUrl.searchParams.get("tenantId")?.trim()
  const body = (await request.json().catch(() => ({}))) as DeleteQuotaBody
  const bodyTenantId = typeof body.tenantId === "string" ? body.tenantId.trim() : ""
  const tenantId = queryTenantId || bodyTenantId

  if (!tenantId) {
    return NextResponse.json({ error: "tenantId is required" }, { status: 400 })
  }

  const pool = getPostgresPool()
  try {
    await pool.query(
      `DELETE FROM signal_api_tenant_quotas
       WHERE tenant_id = $1::text`,
      [tenantId]
    )
    return NextResponse.json({ ok: true, tenantId })
  } catch (error) {
    const known = handleKnownError(error)
    if (known) return known
    return NextResponse.json({ error: (error as Error).message }, { status: 500 })
  }
}
