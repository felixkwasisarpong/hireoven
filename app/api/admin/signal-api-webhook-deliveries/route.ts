import { NextRequest, NextResponse } from "next/server"
import { assertAdminAccess } from "@/lib/admin/auth"
import { getPostgresPool } from "@/lib/postgres/server"
import {
  drainSignalApiWebhookDeliveryQueue,
  replayFailedSignalApiWebhookDeliveries,
  replaySignalApiWebhookDelivery,
  type SignalApiWebhookQueueStatus,
} from "@/lib/signal-api/webhooks"

export const runtime = "nodejs"

type DeliveryRow = {
  id: string
  subscription_id: string
  subscription_name: string | null
  tenant_id: string
  event_id: string
  event_type: string
  target_url: string
  attempt_number: number | string | null
  status_code: number | string | null
  success: boolean
  duration_ms: number | string | null
  error_message: string | null
  response_body: string | null
  created_at: string | null
  job_status: SignalApiWebhookQueueStatus | null
  job_attempt_count: number | string | null
  job_max_attempts: number | string | null
  job_next_attempt_at: string | null
  job_delivered_at: string | null
}

type PostBody = {
  action?: unknown
  deliveryId?: unknown
  subscriptionId?: unknown
  tenantId?: unknown
  limit?: unknown
}

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value)
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function clampInt(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? "", 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

function parseOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function parseOptionalLimit(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.min(max, Math.max(min, Math.floor(value)))
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed)) return Math.min(max, Math.max(min, parsed))
  }
  return fallback
}

function csvEscape(value: unknown): string {
  const text = String(value ?? "")
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

function missingTablesResponse() {
  return NextResponse.json(
    {
      error: "Signal API webhook delivery tables are missing",
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
    return NextResponse.json({ error: "Invalid webhook filter" }, { status: 400 })
  }

  if (error instanceof Error && error.message === "Webhook subscription is inactive") {
    return NextResponse.json({ error: error.message }, { status: 409 })
  }

  return null
}

async function fetchDeliveries(params: {
  tenantId: string | null
  subscriptionId: string | null
  outcome: "all" | "success" | "failed"
  limit: number
}) {
  const pool = getPostgresPool()
  return pool.query<DeliveryRow>(
    `SELECT
       delivery.id::text,
       delivery.subscription_id::text,
       sub.name AS subscription_name,
       delivery.tenant_id,
       delivery.event_id::text,
       delivery.event_type,
       delivery.target_url,
       delivery.attempt_number,
       delivery.status_code,
       delivery.success,
       delivery.duration_ms,
       delivery.error_message,
       delivery.response_body,
       delivery.created_at::text,
       job.status AS job_status,
       job.attempt_count AS job_attempt_count,
       job.max_attempts AS job_max_attempts,
       job.next_attempt_at::text AS job_next_attempt_at,
       job.delivered_at::text AS job_delivered_at
     FROM signal_api_webhook_deliveries delivery
     JOIN signal_api_webhook_subscriptions sub
       ON sub.id = delivery.subscription_id
     LEFT JOIN signal_api_webhook_delivery_jobs job
       ON job.subscription_id = delivery.subscription_id
      AND job.event_id = delivery.event_id
     WHERE ($1::text IS NULL OR delivery.tenant_id = $1::text)
       AND ($2::uuid IS NULL OR delivery.subscription_id = $2::uuid)
       AND (
         $3::text = 'all'
         OR ($3::text = 'success' AND delivery.success = true)
         OR ($3::text = 'failed' AND delivery.success = false)
       )
     ORDER BY delivery.created_at DESC
     LIMIT $4`,
    [params.tenantId, params.subscriptionId, params.outcome, params.limit]
  )
}

export async function GET(request: NextRequest) {
  const access = await assertAdminAccess()
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const tenantId = request.nextUrl.searchParams.get("tenantId")?.trim() || null
  const subscriptionId = request.nextUrl.searchParams.get("subscriptionId")?.trim() || null
  const limit = clampInt(request.nextUrl.searchParams.get("limit"), 100, 1, 500)
  const format = request.nextUrl.searchParams.get("format")?.trim() || "json"
  const outcomeRaw = request.nextUrl.searchParams.get("outcome")?.trim() || "all"
  const outcome = outcomeRaw === "success" || outcomeRaw === "failed" ? outcomeRaw : "all"

  try {
    const result = await fetchDeliveries({ tenantId, subscriptionId, outcome, limit })
    const deliveries = result.rows.map((row) => ({
      id: row.id,
      subscriptionId: row.subscription_id,
      subscriptionName: row.subscription_name,
      tenantId: row.tenant_id,
      eventId: row.event_id,
      eventType: row.event_type,
      targetUrl: row.target_url,
      attemptNumber: toNumber(row.attempt_number),
      statusCode: row.status_code == null ? null : toNumber(row.status_code),
      success: row.success,
      durationMs: toNumber(row.duration_ms),
      errorMessage: row.error_message,
      responseBody: row.response_body,
      createdAt: row.created_at,
      jobStatus: row.job_status,
      jobAttemptCount: row.job_attempt_count == null ? 0 : toNumber(row.job_attempt_count),
      jobMaxAttempts: row.job_max_attempts == null ? 0 : toNumber(row.job_max_attempts),
      jobNextAttemptAt: row.job_next_attempt_at,
      jobDeliveredAt: row.job_delivered_at,
    }))

    if (format === "csv") {
      const lines = [
        [
          "delivery_id",
          "created_at",
          "subscription_id",
          "subscription_name",
          "tenant_id",
          "event_id",
          "event_type",
          "target_url",
          "attempt_number",
          "status_code",
          "success",
          "duration_ms",
          "error_message",
          "job_status",
          "job_attempt_count",
          "job_max_attempts",
          "job_next_attempt_at",
          "job_delivered_at",
        ].join(","),
        ...deliveries.map((delivery) =>
          [
            delivery.id,
            delivery.createdAt,
            delivery.subscriptionId,
            delivery.subscriptionName,
            delivery.tenantId,
            delivery.eventId,
            delivery.eventType,
            delivery.targetUrl,
            delivery.attemptNumber,
            delivery.statusCode ?? "",
            delivery.success ? "Y" : "N",
            delivery.durationMs,
            delivery.errorMessage ?? "",
            delivery.jobStatus ?? "",
            delivery.jobAttemptCount,
            delivery.jobMaxAttempts,
            delivery.jobNextAttemptAt ?? "",
            delivery.jobDeliveredAt ?? "",
          ].map(csvEscape).join(",")
        ),
      ]

      return new NextResponse(lines.join("\n"), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="signal-api-webhook-deliveries.csv"',
        },
      })
    }

    return NextResponse.json({ deliveries })
  } catch (error) {
    const known = handleKnownError(error)
    if (known) return known
    return NextResponse.json({ error: (error as Error).message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const access = await assertAdminAccess()
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const body = (await request.json().catch(() => ({}))) as PostBody
  const action = typeof body.action === "string" ? body.action.trim() : ""

  if (!action) {
    return NextResponse.json({ error: "action is required" }, { status: 400 })
  }

  try {
    if (action === "replay") {
      const deliveryId = parseOptionalString(body.deliveryId)
      if (!deliveryId) {
        return NextResponse.json({ error: "deliveryId is required" }, { status: 400 })
      }

      const result = await replaySignalApiWebhookDelivery(deliveryId)
      if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 })
      return NextResponse.json({
        ok: true,
        replayedCount: result.replayed ? 1 : 0,
        subscriptionId: result.subscriptionId,
        eventId: result.eventId,
      })
    }

    if (action === "replay_failed") {
      const replayedCount = await replayFailedSignalApiWebhookDeliveries({
        subscriptionId: parseOptionalString(body.subscriptionId),
        tenantId: parseOptionalString(body.tenantId),
        limit: parseOptionalLimit(body.limit, 25, 1, 200),
      })

      return NextResponse.json({ ok: true, replayedCount })
    }

    if (action === "drain") {
      const result = await drainSignalApiWebhookDeliveryQueue({
        limit: parseOptionalLimit(body.limit, 25, 1, 200),
        workerId: `admin:${access.profile.id}`,
      })

      return NextResponse.json({ ok: true, ...result })
    }

    return NextResponse.json(
      { error: "Unknown action. Use replay, replay_failed, or drain." },
      { status: 400 }
    )
  } catch (error) {
    const known = handleKnownError(error)
    if (known) return known
    return NextResponse.json({ error: (error as Error).message }, { status: 500 })
  }
}
