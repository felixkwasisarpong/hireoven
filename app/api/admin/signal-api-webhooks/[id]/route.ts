import { NextRequest, NextResponse } from "next/server"
import { assertAdminAccess } from "@/lib/admin/auth"
import { getPostgresPool } from "@/lib/postgres/server"
import {
  createSignalApiWebhookSecret,
  emitSignalApiWebhookEvent,
  normalizeSignalApiWebhookEventTypes,
  SIGNAL_API_WEBHOOK_EVENT_TYPES,
  type SignalApiWebhookEventType,
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
}

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value)
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
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
  }
}

function isValidWebhookUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === "https:" || url.protocol === "http:"
  } catch {
    return false
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

async function fetchSubscriptionById(id: string): Promise<WebhookSubscriptionRow | null> {
  const pool = getPostgresPool()
  const result = await pool.query<WebhookSubscriptionRow>(
    `SELECT
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
       signing_secret
     FROM signal_api_webhook_subscriptions
     WHERE id = $1::uuid
     LIMIT 1`,
    [id]
  )
  return result.rows[0] ?? null
}

type PatchBody = {
  action?: unknown
  name?: unknown
  targetUrl?: unknown
  eventTypes?: unknown
  metadata?: unknown
  isActive?: unknown
  eventType?: unknown
  data?: unknown
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const access = await assertAdminAccess()
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const { id } = await params
  const body = (await request.json().catch(() => ({}))) as PatchBody
  const action = typeof body.action === "string" ? body.action.trim() : ""

  if (!action) {
    return NextResponse.json({ error: "action is required" }, { status: 400 })
  }

  const pool = getPostgresPool()

  try {
    if (action === "rotate") {
      const signingSecret = createSignalApiWebhookSecret()
      const result = await pool.query<WebhookSubscriptionRow>(
        `UPDATE signal_api_webhook_subscriptions
         SET
           signing_secret = $2::text,
           updated_by_user_id = $3::uuid,
           updated_at = NOW()
         WHERE id = $1::uuid
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
           signing_secret`,
        [id, signingSecret, access.profile.id]
      )

      if (!result.rows[0]) return NextResponse.json({ error: "Not found" }, { status: 404 })

      return NextResponse.json({
        subscription: serializeSubscription(result.rows[0]),
        signingSecret,
      })
    }

    if (action === "activate" || action === "deactivate") {
      const isActive = action === "activate"
      const result = await pool.query<WebhookSubscriptionRow>(
        `UPDATE signal_api_webhook_subscriptions
         SET
           is_active = $2::boolean,
           updated_by_user_id = $3::uuid,
           updated_at = NOW()
         WHERE id = $1::uuid
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
           signing_secret`,
        [id, isActive, access.profile.id]
      )

      if (!result.rows[0]) return NextResponse.json({ error: "Not found" }, { status: 404 })
      return NextResponse.json({ subscription: serializeSubscription(result.rows[0]) })
    }

    if (action === "update") {
      const setClauses: string[] = []
      const values: unknown[] = []

      if ("name" in body) {
        if (typeof body.name !== "string" || !body.name.trim()) {
          return NextResponse.json({ error: "name must be a non-empty string" }, { status: 400 })
        }
        values.push(body.name.trim())
        setClauses.push(`name = $${values.length}::text`)
      }

      if ("targetUrl" in body) {
        if (typeof body.targetUrl !== "string" || !isValidWebhookUrl(body.targetUrl.trim())) {
          return NextResponse.json(
            { error: "targetUrl must be a valid http(s) URL" },
            { status: 400 }
          )
        }
        values.push(body.targetUrl.trim())
        setClauses.push(`target_url = $${values.length}::text`)
      }

      if ("eventTypes" in body) {
        const eventTypes = normalizeSignalApiWebhookEventTypes(body.eventTypes)
        if (!eventTypes) {
          return NextResponse.json(
            { error: "eventTypes must be a supported array or comma-separated string" },
            { status: 400 }
          )
        }
        values.push(eventTypes)
        setClauses.push(`event_types = $${values.length}::text[]`)
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
        setClauses.push(`is_active = $${values.length}::boolean`)
      }

      if (setClauses.length === 0) {
        return NextResponse.json({ error: "No valid fields to update" }, { status: 400 })
      }

      values.push(access.profile.id)
      setClauses.push(`updated_by_user_id = $${values.length}::uuid`)
      setClauses.push(`updated_at = NOW()`)

      values.push(id)
      const result = await pool.query<WebhookSubscriptionRow>(
        `UPDATE signal_api_webhook_subscriptions
         SET ${setClauses.join(", ")}
         WHERE id = $${values.length}::uuid
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
           signing_secret`,
        values
      )

      if (!result.rows[0]) return NextResponse.json({ error: "Not found" }, { status: 404 })
      return NextResponse.json({ subscription: serializeSubscription(result.rows[0]) })
    }

    if (action === "test") {
      const subscription = await fetchSubscriptionById(id)
      if (!subscription) return NextResponse.json({ error: "Not found" }, { status: 404 })

      const eventType = (
        typeof body.eventType === "string" && body.eventType.trim()
          ? body.eventType.trim()
          : "signal.job_ingested"
      ) as SignalApiWebhookEventType

      if (!SIGNAL_API_WEBHOOK_EVENT_TYPES.includes(eventType)) {
        return NextResponse.json({ error: "Unsupported eventType" }, { status: 400 })
      }

      const data =
        body.data && typeof body.data === "object" && !Array.isArray(body.data)
          ? (body.data as Record<string, unknown>)
          : {
              test: true,
              subscriptionId: subscription.id,
              subscriptionName: subscription.name,
            }

      const result = await emitSignalApiWebhookEvent({
        tenantId: subscription.tenant_id,
        eventType,
        data,
        subscriptionIds: [subscription.id],
      })

      return NextResponse.json({
        ok: true,
        eventId: result.event.id,
        subscriptionCount: result.subscriptionCount,
        queuedCount: result.queuedCount,
      })
    }

    return NextResponse.json(
      { error: "Unknown action. Use update, rotate, activate, deactivate, or test." },
      { status: 400 }
    )
  } catch (error) {
    const known = handleKnownError(error)
    if (known) return known
    return NextResponse.json({ error: (error as Error).message }, { status: 500 })
  }
}
