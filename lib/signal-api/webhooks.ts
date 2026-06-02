import { createHmac, randomBytes, randomUUID } from "crypto"
import { getPostgresPool } from "@/lib/postgres/server"

export const SIGNAL_API_WEBHOOK_EVENT_TYPES = [
  "signal.new_match",
  "signal.top_drop",
  "signal.sponsorship_shift",
  "signal.market_shift",
  "signal.followup_required",
  "signal.interview_reminder",
  "signal.job_ingested",
  "signal.outcome_recorded",
] as const

export type SignalApiWebhookEventType = (typeof SIGNAL_API_WEBHOOK_EVENT_TYPES)[number]
export type SignalApiWebhookQueueStatus = "pending" | "processing" | "delivered" | "dead_letter"

type WebhookSubscriptionRow = {
  id: string
  tenant_id: string
  name: string
  target_url: string
  signing_secret: string
  event_types: string[] | null
  is_active: boolean
}

type WebhookDeliveryJobRow = {
  id: string
  subscription_id: string
  tenant_id: string
  event_id: string
  event_type: string
  target_url: string
  signing_secret: string
  subscription_is_active: boolean
  payload: SignalApiWebhookEnvelope
  attempt_count: number | string | null
  max_attempts: number | string | null
}

export type SignalApiWebhookEnvelope = {
  id: string
  eventType: SignalApiWebhookEventType
  occurredAt: string
  tenantId: string
  data: Record<string, unknown>
}

type EmitSignalApiWebhookEventParams = {
  tenantId: string
  eventType: SignalApiWebhookEventType
  data: Record<string, unknown>
  subscriptionIds?: string[]
}

type ReplayWebhookDeliveriesParams = {
  subscriptionId?: string | null
  tenantId?: string | null
  limit?: number
}

type WebhookConfig = {
  timeoutMs: number
  maxAttempts: number
  retryBackoffMs: number
  batchSize: number
  lockSeconds: number
}

type DeliveryAttemptParams = {
  subscriptionId: string
  eventId: string
  tenantId: string
  eventType: string
  targetUrl: string
  attemptNumber: number
  statusCode: number | null
  success: boolean
  durationMs: number
  errorMessage: string | null
  responseBody: string | null
}

type QueueReplayRow = {
  subscription_id: string
  event_id: string
  tenant_id: string
  event_type: string
  target_url: string
}

function readPositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? "", 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function toInteger(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value)
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

export function getSignalApiWebhookConfig(): WebhookConfig {
  return {
    timeoutMs: readPositiveInt(process.env.APEX_SIGNAL_API_WEBHOOK_TIMEOUT_MS, 3000),
    maxAttempts: readPositiveInt(process.env.APEX_SIGNAL_API_WEBHOOK_MAX_ATTEMPTS, 2),
    retryBackoffMs: readPositiveInt(process.env.APEX_SIGNAL_API_WEBHOOK_RETRY_BACKOFF_MS, 250),
    batchSize: readPositiveInt(process.env.APEX_SIGNAL_API_WEBHOOK_BATCH_SIZE, 25),
    lockSeconds: readPositiveInt(process.env.APEX_SIGNAL_API_WEBHOOK_LOCK_SECONDS, 120),
  }
}

export function createSignalApiWebhookSecret(): string {
  return `apxwhsec_${randomBytes(24).toString("hex")}`
}

export function normalizeSignalApiWebhookEventTypes(raw: unknown): string[] | null {
  if (raw === undefined || raw === null) return []

  const values = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? raw.split(",")
      : null

  if (!values) return null

  const normalized = [...new Set(
    values
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter(Boolean)
  )]

  const allowed = new Set<string>(SIGNAL_API_WEBHOOK_EVENT_TYPES)
  if (normalized.some((value) => !allowed.has(value))) {
    return null
  }

  return normalized
}

function signSignalApiWebhook(rawBody: string, secret: string, timestamp: string): string {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex")
}

function truncateText(value: string | null | undefined, max = 2000): string | null {
  if (!value) return null
  return value.length <= max ? value : value.slice(0, max)
}

function toDurationMs(startedAtMs: number): number {
  const delta = Date.now() - startedAtMs
  if (!Number.isFinite(delta) || delta < 0) return 0
  return Math.min(Math.floor(delta), 2_147_483_647)
}

function nextAttemptAt(backoffMs: number, attemptNumber: number): string {
  return new Date(Date.now() + backoffMs * Math.max(1, attemptNumber)).toISOString()
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }
}

async function createWebhookEvent(envelope: SignalApiWebhookEnvelope): Promise<void> {
  const pool = getPostgresPool()
  await pool.query(
    `INSERT INTO signal_api_webhook_events (
       id,
       tenant_id,
       event_type,
       payload
     ) VALUES ($1::uuid, $2::text, $3::text, $4::jsonb)`,
    [envelope.id, envelope.tenantId, envelope.eventType, JSON.stringify(envelope)]
  )
}

async function loadWebhookSubscriptions(
  tenantId: string,
  eventType: string,
  subscriptionIds?: string[]
): Promise<WebhookSubscriptionRow[]> {
  const pool = getPostgresPool()
  const result = await pool.query<WebhookSubscriptionRow>(
    `SELECT
       id::text,
       tenant_id,
       name,
       target_url,
       signing_secret,
       event_types,
       is_active
     FROM signal_api_webhook_subscriptions
     WHERE tenant_id = $1::text
       AND is_active = true
       AND (
         COALESCE(array_length(event_types, 1), 0) = 0
         OR $2::text = ANY(event_types)
       )
       AND (
         $3::uuid[] IS NULL
         OR id = ANY($3::uuid[])
       )
     ORDER BY created_at ASC`,
    [tenantId, eventType, subscriptionIds && subscriptionIds.length > 0 ? subscriptionIds : null]
  )
  return result.rows
}

async function updateSubscriptionHealth(
  subscriptionId: string,
  success: boolean
): Promise<void> {
  const pool = getPostgresPool()
  await pool.query(
    `UPDATE signal_api_webhook_subscriptions
     SET
       updated_at = NOW(),
       last_delivery_at = CASE WHEN $2::boolean THEN NOW() ELSE last_delivery_at END,
       last_failure_at = CASE WHEN $2::boolean THEN last_failure_at ELSE NOW() END,
       consecutive_failures = CASE
         WHEN $2::boolean THEN 0
         ELSE consecutive_failures + 1
       END
     WHERE id = $1::uuid`,
    [subscriptionId, success]
  )
}

async function insertDeliveryLog(params: DeliveryAttemptParams): Promise<void> {
  const pool = getPostgresPool()
  await pool.query(
    `INSERT INTO signal_api_webhook_deliveries (
       subscription_id,
       event_id,
       tenant_id,
       event_type,
       target_url,
       attempt_number,
       status_code,
       success,
       duration_ms,
       error_message,
       response_body
     ) VALUES (
       $1::uuid,
       $2::uuid,
       $3::text,
       $4::text,
       $5::text,
       $6::int,
       $7::int,
       $8::boolean,
       $9::int,
       $10::text,
       $11::text
     )`,
    [
      params.subscriptionId,
      params.eventId,
      params.tenantId,
      params.eventType,
      params.targetUrl,
      params.attemptNumber,
      params.statusCode,
      params.success,
      params.durationMs,
      params.errorMessage,
      params.responseBody,
    ]
  )
}

async function enqueueWebhookDeliveryJobs(
  envelope: SignalApiWebhookEnvelope,
  subscriptions: WebhookSubscriptionRow[],
  config: WebhookConfig
): Promise<number> {
  if (subscriptions.length === 0) return 0

  const pool = getPostgresPool()
  const subscriptionIds = subscriptions.map((subscription) => subscription.id)
  const eventIds = subscriptions.map(() => envelope.id)
  const tenantIds = subscriptions.map(() => envelope.tenantId)
  const eventTypes = subscriptions.map(() => envelope.eventType)
  const targetUrls = subscriptions.map((subscription) => subscription.target_url)

  const result = await pool.query(
    `INSERT INTO signal_api_webhook_delivery_jobs (
       subscription_id,
       event_id,
       tenant_id,
       event_type,
       target_url,
       status,
       attempt_count,
       max_attempts,
       next_attempt_at
     )
     SELECT
       item.subscription_id,
       item.event_id,
       item.tenant_id,
       item.event_type,
       item.target_url,
       'pending',
       0,
       $6::int,
       NOW()
     FROM UNNEST(
       $1::uuid[],
       $2::uuid[],
       $3::text[],
       $4::text[],
       $5::text[]
     ) AS item(subscription_id, event_id, tenant_id, event_type, target_url)
     ON CONFLICT (subscription_id, event_id) DO NOTHING`,
    [subscriptionIds, eventIds, tenantIds, eventTypes, targetUrls, config.maxAttempts]
  )

  return result.rowCount ?? 0
}

async function claimWebhookDeliveryJobs(
  limit: number,
  workerId: string,
  lockSeconds: number
): Promise<WebhookDeliveryJobRow[]> {
  const pool = getPostgresPool()
  const claimedResult = await pool.query<{ id: string }>(
    `WITH candidates AS (
       SELECT job.id
       FROM signal_api_webhook_delivery_jobs job
       WHERE (
         (job.status = 'pending' AND job.next_attempt_at <= NOW())
         OR (
           job.status = 'processing'
           AND job.locked_at <= NOW() - make_interval(secs => $3::int)
         )
       )
       ORDER BY job.next_attempt_at ASC, job.created_at ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     UPDATE signal_api_webhook_delivery_jobs job
     SET
       status = 'processing',
       locked_at = NOW(),
       locked_by = $2::text,
       updated_at = NOW()
     FROM candidates
     WHERE job.id = candidates.id
     RETURNING job.id::text`,
    [limit, workerId, lockSeconds]
  )

  const jobIds = claimedResult.rows.map((row) => row.id)
  if (jobIds.length === 0) return []

  const jobsResult = await pool.query<WebhookDeliveryJobRow>(
    `SELECT
       job.id::text,
       job.subscription_id::text,
       job.tenant_id,
       job.event_id::text,
       job.event_type,
       job.target_url,
       sub.signing_secret,
       sub.is_active AS subscription_is_active,
       event.payload,
       job.attempt_count,
       job.max_attempts
     FROM signal_api_webhook_delivery_jobs job
     JOIN signal_api_webhook_subscriptions sub
       ON sub.id = job.subscription_id
     JOIN signal_api_webhook_events event
       ON event.id = job.event_id
     WHERE job.id = ANY($1::uuid[])
     ORDER BY job.created_at ASC`,
    [jobIds]
  )

  return jobsResult.rows
}

async function updateWebhookDeliveryJob(
  jobId: string,
  params: {
    status: SignalApiWebhookQueueStatus
    attemptCount: number
    statusCode: number | null
    durationMs: number | null
    errorMessage: string | null
    nextAttemptAt: string
    deliveredAt?: string | null
  }
): Promise<void> {
  const pool = getPostgresPool()
  await pool.query(
    `UPDATE signal_api_webhook_delivery_jobs
     SET
       status = $2::text,
       attempt_count = $3::int,
       last_attempt_at = NOW(),
       last_status_code = $4::int,
       last_duration_ms = $5::int,
       last_error_message = $6::text,
       next_attempt_at = $7::timestamptz,
       delivered_at = $8::timestamptz,
       locked_at = NULL,
       locked_by = NULL,
       updated_at = NOW()
     WHERE id = $1::uuid`,
    [
      jobId,
      params.status,
      params.attemptCount,
      params.statusCode,
      params.durationMs,
      params.errorMessage,
      params.nextAttemptAt,
      params.deliveredAt ?? null,
    ]
  )
}

async function requeueWebhookDeliveryJobs(rows: QueueReplayRow[], maxAttempts: number): Promise<number> {
  if (rows.length === 0) return 0

  const pool = getPostgresPool()
  let replayedCount = 0

  for (const row of rows) {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO signal_api_webhook_delivery_jobs (
         subscription_id,
         event_id,
         tenant_id,
         event_type,
         target_url,
         status,
         attempt_count,
         max_attempts,
         next_attempt_at,
         last_attempt_at,
         last_status_code,
         last_duration_ms,
         last_error_message,
         locked_at,
         locked_by,
         delivered_at,
         updated_at
       ) VALUES (
         $1::uuid,
         $2::uuid,
         $3::text,
         $4::text,
         $5::text,
         'pending',
         0,
         $6::int,
         NOW(),
         NULL,
         NULL,
         NULL,
         NULL,
         NULL,
         NULL,
         NULL,
         NOW()
       )
       ON CONFLICT (subscription_id, event_id)
       DO UPDATE SET
         tenant_id = EXCLUDED.tenant_id,
         event_type = EXCLUDED.event_type,
         target_url = EXCLUDED.target_url,
         status = 'pending',
         attempt_count = 0,
         max_attempts = EXCLUDED.max_attempts,
         next_attempt_at = NOW(),
         last_attempt_at = NULL,
         last_status_code = NULL,
         last_duration_ms = NULL,
         last_error_message = NULL,
         locked_at = NULL,
         locked_by = NULL,
         delivered_at = NULL,
         updated_at = NOW()
       RETURNING id::text`,
      [
        row.subscription_id,
        row.event_id,
        row.tenant_id,
        row.event_type,
        row.target_url,
        maxAttempts,
      ]
    )

    if (result.rows[0]) replayedCount += 1
  }

  return replayedCount
}

async function deliverWebhookJob(
  job: WebhookDeliveryJobRow,
  config: WebhookConfig
): Promise<SignalApiWebhookQueueStatus> {
  const attemptNumber = toInteger(job.attempt_count, 0) + 1
  const maxAttempts = Math.max(1, toInteger(job.max_attempts, config.maxAttempts))

  if (!job.subscription_is_active) {
    await updateWebhookDeliveryJob(job.id, {
      status: "dead_letter",
      attemptCount: toInteger(job.attempt_count, 0),
      statusCode: null,
      durationMs: null,
      errorMessage: "Subscription inactive",
      nextAttemptAt: new Date().toISOString(),
      deliveredAt: null,
    })
    return "dead_letter"
  }

  const rawBody = JSON.stringify(job.payload)
  const startedAtMs = Date.now()
  const timestamp = new Date().toISOString()
  const signature = signSignalApiWebhook(rawBody, job.signing_secret, timestamp)

  try {
    const response = await fetchWithTimeout(
      job.target_url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Apex-Signal-Webhook/1.0",
          "X-Apex-Webhook-Id": job.payload.id,
          "X-Apex-Event-Type": job.payload.eventType,
          "X-Apex-Webhook-Attempt": String(attemptNumber),
          "X-Apex-Webhook-Timestamp": timestamp,
          "X-Apex-Webhook-Signature": `sha256=${signature}`,
        },
        body: rawBody,
      },
      config.timeoutMs
    )

    const durationMs = toDurationMs(startedAtMs)
    const responseBody = truncateText(await response.text().catch(() => null))
    const success = response.status >= 200 && response.status < 300

    await insertDeliveryLog({
      subscriptionId: job.subscription_id,
      eventId: job.event_id,
      tenantId: job.tenant_id,
      eventType: job.event_type,
      targetUrl: job.target_url,
      attemptNumber,
      statusCode: response.status,
      success,
      durationMs,
      errorMessage: success ? null : `HTTP ${response.status}`,
      responseBody,
    })

    await updateSubscriptionHealth(job.subscription_id, success)

    if (success) {
      await updateWebhookDeliveryJob(job.id, {
        status: "delivered",
        attemptCount: attemptNumber,
        statusCode: response.status,
        durationMs,
        errorMessage: null,
        nextAttemptAt: new Date().toISOString(),
        deliveredAt: new Date().toISOString(),
      })
      return "delivered"
    }

    const finalFailure = attemptNumber >= maxAttempts
    await updateWebhookDeliveryJob(job.id, {
      status: finalFailure ? "dead_letter" : "pending",
      attemptCount: attemptNumber,
      statusCode: response.status,
      durationMs,
      errorMessage: `HTTP ${response.status}`,
      nextAttemptAt: finalFailure
        ? new Date().toISOString()
        : nextAttemptAt(config.retryBackoffMs, attemptNumber),
      deliveredAt: null,
    })
    return finalFailure ? "dead_letter" : "pending"
  } catch (error) {
    const durationMs = toDurationMs(startedAtMs)
    const message = error instanceof Error ? error.message : "Unknown delivery error"

    await insertDeliveryLog({
      subscriptionId: job.subscription_id,
      eventId: job.event_id,
      tenantId: job.tenant_id,
      eventType: job.event_type,
      targetUrl: job.target_url,
      attemptNumber,
      statusCode: null,
      success: false,
      durationMs,
      errorMessage: truncateText(message, 1000),
      responseBody: null,
    })

    await updateSubscriptionHealth(job.subscription_id, false)

    const finalFailure = attemptNumber >= maxAttempts
    await updateWebhookDeliveryJob(job.id, {
      status: finalFailure ? "dead_letter" : "pending",
      attemptCount: attemptNumber,
      statusCode: null,
      durationMs,
      errorMessage: truncateText(message, 1000),
      nextAttemptAt: finalFailure
        ? new Date().toISOString()
        : nextAttemptAt(config.retryBackoffMs, attemptNumber),
      deliveredAt: null,
    })
    return finalFailure ? "dead_letter" : "pending"
  }
}

export async function emitSignalApiWebhookEvent(
  params: EmitSignalApiWebhookEventParams
): Promise<{ event: SignalApiWebhookEnvelope; subscriptionCount: number; queuedCount: number }> {
  const envelope: SignalApiWebhookEnvelope = {
    id: randomUUID(),
    eventType: params.eventType,
    occurredAt: new Date().toISOString(),
    tenantId: params.tenantId,
    data: params.data,
  }

  await createWebhookEvent(envelope)
  const subscriptions = await loadWebhookSubscriptions(
    params.tenantId,
    params.eventType,
    params.subscriptionIds
  )

  if (subscriptions.length === 0) {
    return {
      event: envelope,
      subscriptionCount: 0,
      queuedCount: 0,
    }
  }

  const config = getSignalApiWebhookConfig()
  const queuedCount = await enqueueWebhookDeliveryJobs(envelope, subscriptions, config)

  return {
    event: envelope,
    subscriptionCount: subscriptions.length,
    queuedCount,
  }
}

export async function drainSignalApiWebhookDeliveryQueue(options?: {
  limit?: number
  workerId?: string
}): Promise<{
  claimedCount: number
  deliveredCount: number
  rescheduledCount: number
  deadLetterCount: number
  failedCount: number
  workerId: string
}> {
  const config = getSignalApiWebhookConfig()
  const limit = Math.max(1, Math.min(options?.limit ?? config.batchSize, 200))
  const workerId = options?.workerId?.trim() || `signal-api-webhooks:${process.pid}:${Date.now()}`
  const jobs = await claimWebhookDeliveryJobs(limit, workerId, config.lockSeconds)

  if (jobs.length === 0) {
    return {
      claimedCount: 0,
      deliveredCount: 0,
      rescheduledCount: 0,
      deadLetterCount: 0,
      failedCount: 0,
      workerId,
    }
  }

  const settled = await Promise.allSettled(jobs.map((job) => deliverWebhookJob(job, config)))
  let deliveredCount = 0
  let rescheduledCount = 0
  let deadLetterCount = 0
  let failedCount = 0

  for (const result of settled) {
    if (result.status === "rejected") {
      failedCount += 1
      continue
    }

    if (result.value === "delivered") deliveredCount += 1
    else if (result.value === "pending") rescheduledCount += 1
    else if (result.value === "dead_letter") deadLetterCount += 1
  }

  return {
    claimedCount: jobs.length,
    deliveredCount,
    rescheduledCount,
    deadLetterCount,
    failedCount,
    workerId,
  }
}

export async function replaySignalApiWebhookDelivery(
  deliveryId: string
): Promise<{ replayed: boolean; subscriptionId: string; eventId: string } | null> {
  const pool = getPostgresPool()
  const config = getSignalApiWebhookConfig()
  const result = await pool.query<QueueReplayRow & { is_active: boolean }>(
    `SELECT
       delivery.subscription_id::text,
       delivery.event_id::text,
       delivery.tenant_id,
       delivery.event_type,
       delivery.target_url,
       sub.is_active
     FROM signal_api_webhook_deliveries delivery
     JOIN signal_api_webhook_subscriptions sub
       ON sub.id = delivery.subscription_id
     WHERE delivery.id = $1::uuid
     LIMIT 1`,
    [deliveryId]
  )

  const row = result.rows[0]
  if (!row) return null
  if (!row.is_active) {
    throw new Error("Webhook subscription is inactive")
  }

  const replayedCount = await requeueWebhookDeliveryJobs([row], config.maxAttempts)
  return {
    replayed: replayedCount > 0,
    subscriptionId: row.subscription_id,
    eventId: row.event_id,
  }
}

export async function replayFailedSignalApiWebhookDeliveries(
  params: ReplayWebhookDeliveriesParams
): Promise<number> {
  const pool = getPostgresPool()
  const config = getSignalApiWebhookConfig()
  const limit = Math.max(1, Math.min(params.limit ?? config.batchSize, 200))

  const result = await pool.query<QueueReplayRow>(
    `SELECT DISTINCT ON (delivery.subscription_id, delivery.event_id)
       delivery.subscription_id::text,
       delivery.event_id::text,
       delivery.tenant_id,
       delivery.event_type,
       delivery.target_url
     FROM signal_api_webhook_deliveries delivery
     JOIN signal_api_webhook_subscriptions sub
       ON sub.id = delivery.subscription_id
     WHERE delivery.success = false
       AND ($1::uuid IS NULL OR delivery.subscription_id = $1::uuid)
       AND ($2::text IS NULL OR delivery.tenant_id = $2::text)
       AND sub.is_active = true
     ORDER BY delivery.subscription_id, delivery.event_id, delivery.created_at DESC
     LIMIT $3`,
    [params.subscriptionId ?? null, params.tenantId ?? null, limit]
  )

  return requeueWebhookDeliveryJobs(result.rows, config.maxAttempts)
}
