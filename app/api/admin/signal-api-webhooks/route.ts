import { NextRequest, NextResponse } from "next/server"
import { assertAdminAccess } from "@/lib/admin/auth"
import { getPostgresPool } from "@/lib/postgres/server"
import {
  createSignalApiWebhookSecret,
  normalizeSignalApiWebhookEventTypes,
} from "@/lib/signal-api/webhooks"

export const runtime = "nodejs"

type WebhookSubscriptionRow = {
  id: string
  tenant_id: string
  name: string
  target_url: string
  event_types: string[] | null
  is_active: boolean
  created_by_user_id: string | null
  updated_by_user_id: string | null
  last_delivery_at: string | null
  last_failure_at: string | null
  consecutive_failures: number | string | null
  metadata: unknown
  created_at: string | null
  updated_at: string | null
  signing_secret: string
  delivery_count: number | string | null
  failure_count: number | string | null
  latest_status_code: number | string | null
  latest_success: boolean | null
}

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value)
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function isValidWebhookUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === "https:" || url.protocol === "http:"
  } catch {
    return false
  }
}

function serializeSubscription(row: WebhookSubscriptionRow) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    targetUrl: row.target_url,
    eventTypes: row.event_types ?? [],
    isActive: row.is_active,
    createdByUserId: row.created_by_user_id,
    updatedByUserId: row.updated_by_user_id,
    lastDeliveryAt: row.last_delivery_at,
    lastFailureAt: row.last_failure_at,
    consecutiveFailures: toNumber(row.consecutive_failures),
    metadata: row.metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    secretPrefix: row.signing_secret.slice(0, 16),
    deliveryCount: toNumber(row.delivery_count),
    failureCount: toNumber(row.failure_count),
    latestStatusCode: row.latest_status_code == null ? null : toNumber(row.latest_status_code),
    latestSuccess: row.latest_success,
  }
}

function missingTablesResponse() {
  return NextResponse.json(
    {
      error: "Signal API webhook tables are missing",
      hint: "Run scripts/migrations/add-signal-api-webhooks.sql and scripts/migrations/add-signal-api-webhook-delivery-jobs.sql",
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
    return NextResponse.json({ error: "Invalid webhook id or payload" }, { status: 400 })
  }
  return null
}

async function fetchSubscriptions(tenantId?: string | null) {
  const pool = getPostgresPool()
  const result = await pool.query<WebhookSubscriptionRow>(
    `SELECT
       sub.id::text,
       sub.tenant_id,
       sub.name,
       sub.target_url,
       sub.event_types,
       sub.is_active,
       sub.created_by_user_id::text,
       sub.updated_by_user_id::text,
       sub.last_delivery_at::text,
       sub.last_failure_at::text,
       sub.consecutive_failures,
       sub.metadata,
       sub.created_at::text,
       sub.updated_at::text,
       sub.signing_secret,
       COALESCE(stats.delivery_count, 0) AS delivery_count,
       COALESCE(stats.failure_count, 0) AS failure_count,
       latest.status_code AS latest_status_code,
       latest.success AS latest_success
     FROM signal_api_webhook_subscriptions sub
     LEFT JOIN LATERAL (
       SELECT
         COUNT(*)::bigint AS delivery_count,
         COUNT(*) FILTER (WHERE success = false)::bigint AS failure_count
       FROM signal_api_webhook_deliveries
       WHERE subscription_id = sub.id
     ) stats ON true
     LEFT JOIN LATERAL (
       SELECT status_code, success
       FROM signal_api_webhook_deliveries
       WHERE subscription_id = sub.id
       ORDER BY created_at DESC
       LIMIT 1
     ) latest ON true
     WHERE ($1::text IS NULL OR sub.tenant_id = $1::text)
     ORDER BY sub.created_at DESC
     LIMIT 500`,
    [tenantId ?? null]
  )

  return result.rows.map(serializeSubscription)
}

export async function GET(request: NextRequest) {
  const access = await assertAdminAccess()
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const tenantId = request.nextUrl.searchParams.get("tenantId")?.trim() || null

  try {
    const subscriptions = await fetchSubscriptions(tenantId)
    return NextResponse.json({ subscriptions })
  } catch (error) {
    const known = handleKnownError(error)
    if (known) return known
    return NextResponse.json({ error: (error as Error).message }, { status: 500 })
  }
}

type CreateWebhookBody = {
  tenantId?: unknown
  name?: unknown
  targetUrl?: unknown
  eventTypes?: unknown
  metadata?: unknown
}

export async function POST(request: NextRequest) {
  const access = await assertAdminAccess()
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const body = (await request.json().catch(() => ({}))) as CreateWebhookBody
  const tenantId = typeof body.tenantId === "string" ? body.tenantId.trim() : ""
  const name = typeof body.name === "string" ? body.name.trim() : ""
  const targetUrl = typeof body.targetUrl === "string" ? body.targetUrl.trim() : ""

  if (!tenantId) return NextResponse.json({ error: "tenantId is required" }, { status: 400 })
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 })
  if (!targetUrl || !isValidWebhookUrl(targetUrl)) {
    return NextResponse.json({ error: "targetUrl must be a valid http(s) URL" }, { status: 400 })
  }

  const eventTypes = normalizeSignalApiWebhookEventTypes(body.eventTypes)
  if (!eventTypes) {
    return NextResponse.json(
      { error: "eventTypes must be a supported array or comma-separated string" },
      { status: 400 }
    )
  }

  const metadata = body.metadata ?? {}
  if (metadata === null || Array.isArray(metadata) || typeof metadata !== "object") {
    return NextResponse.json({ error: "metadata must be an object" }, { status: 400 })
  }

  const signingSecret = createSignalApiWebhookSecret()
  const pool = getPostgresPool()

  try {
    const result = await pool.query<WebhookSubscriptionRow>(
      `INSERT INTO signal_api_webhook_subscriptions (
         tenant_id,
         name,
         target_url,
         event_types,
         signing_secret,
         created_by_user_id,
         updated_by_user_id,
         metadata
       ) VALUES (
         $1::text,
         $2::text,
         $3::text,
         $4::text[],
         $5::text,
         $6::uuid,
         $6::uuid,
         $7::jsonb
       )
       RETURNING
         id::text,
         tenant_id,
         name,
         target_url,
         event_types,
         is_active,
         created_by_user_id::text,
         updated_by_user_id::text,
         last_delivery_at::text,
         last_failure_at::text,
         consecutive_failures,
         metadata,
         created_at::text,
         updated_at::text,
         signing_secret,
         0::bigint AS delivery_count,
         0::bigint AS failure_count,
         NULL::int AS latest_status_code,
         NULL::boolean AS latest_success`,
      [
        tenantId,
        name,
        targetUrl,
        eventTypes,
        signingSecret,
        access.profile.id,
        JSON.stringify(metadata),
      ]
    )

    return NextResponse.json(
      {
        subscription: serializeSubscription(result.rows[0]),
        signingSecret,
      },
      { status: 201 }
    )
  } catch (error) {
    const known = handleKnownError(error)
    if (known) return known
    return NextResponse.json({ error: (error as Error).message }, { status: 500 })
  }
}
