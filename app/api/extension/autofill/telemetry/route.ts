import { randomUUID } from "crypto"
import { NextResponse } from "next/server"
import { getPostgresPool } from "@/lib/postgres/server"
import {
  extensionCorsHeaders,
  extensionError,
  handleExtensionPreflight,
  readExtensionJsonBody,
  requireExtensionAuth,
} from "@/lib/extension/auth"

export const runtime = "nodejs"

type AutofillStage = "preview" | "attempt" | "success" | "partial" | "error"

type TelemetryBody = {
  jobId?: string | null
  companyName?: string | null
  jobTitle?: string | null
  atsType?: string | null
  stage?: AutofillStage | string | null
  fieldsFilled?: number | null
  fieldsTotal?: number | null
  manualReviewCount?: number | null
  errorMessage?: string | null
  pageUrl?: string | null
  fallbackUsed?: boolean | null
}

function sanitizeStage(raw: unknown): AutofillStage {
  if (typeof raw !== "string") return "attempt"
  const normalized = raw.trim().toLowerCase()
  if (normalized === "preview") return "preview"
  if (normalized === "attempt") return "attempt"
  if (normalized === "success") return "success"
  if (normalized === "partial") return "partial"
  if (normalized === "error") return "error"
  return "attempt"
}

function sanitizeCount(raw: unknown, fallback: number): number {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.max(0, Math.floor(raw))
  }
  if (typeof raw === "string" && raw.trim()) {
    const parsed = Number(raw)
    if (Number.isFinite(parsed)) return Math.max(0, Math.floor(parsed))
  }
  return fallback
}

function sanitizeText(raw: unknown, maxLen = 220): string | null {
  if (typeof raw !== "string") return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  return trimmed.slice(0, maxLen)
}

function sanitizeUuid(raw: unknown): string | null {
  const value = sanitizeText(raw, 40)
  if (!value) return null
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null
}

function normalizeAts(raw: string | null): string {
  const value = raw?.trim().toLowerCase() ?? "generic"
  if (!value) return "generic"
  if (value === "myworkday") return "workday"
  if (value === "jobs.lever") return "lever"
  if (value === "jobs.ashbyhq") return "ashby"
  return value.replace(/[^a-z0-9_]+/g, "_").slice(0, 40) || "generic"
}

async function bumpFeatureUsage(userId: string, feature: string) {
  const pool = getPostgresPool()
  await pool.query(
    `INSERT INTO feature_usage (user_id, feature, period_start, count, updated_at)
     VALUES ($1::uuid, $2::text, CURRENT_DATE, 1, now())
     ON CONFLICT (user_id, feature, period_start)
     DO UPDATE SET count = feature_usage.count + 1, updated_at = now()`,
    [userId, feature],
  )
}

async function appendApplicationTimeline(args: {
  userId: string
  jobId: string
  stage: AutofillStage
  ats: string
  fieldsFilled: number
  fieldsTotal: number
  manualReviewCount: number
  errorMessage: string | null
  fallbackUsed: boolean
}) {
  const pool = getPostgresPool()
  const event = {
    id: randomUUID(),
    type: "autofill_event",
    status: args.stage,
    date: new Date().toISOString(),
    auto: true,
    note: [
      `Scout autofill ${args.stage}`,
      `ATS=${args.ats}`,
      `${args.fieldsFilled}/${args.fieldsTotal} fields`,
      args.manualReviewCount > 0 ? `manual_review=${args.manualReviewCount}` : null,
      args.fallbackUsed ? "fallback=generic" : null,
      args.errorMessage ? `error=${args.errorMessage}` : null,
    ].filter(Boolean).join(" · "),
  }

  await pool.query(
    `UPDATE job_applications
     SET timeline = COALESCE(timeline, '[]'::jsonb) || $3::jsonb,
         updated_at = now()
     WHERE user_id = $1::uuid
       AND job_id = $2::uuid
       AND is_archived = false`,
    [args.userId, args.jobId, JSON.stringify([event])],
  )
}

export function OPTIONS(request: Request) {
  return handleExtensionPreflight(request)
}

export async function POST(request: Request) {
  const corsHeaders = extensionCorsHeaders(request.headers.get("origin"))
  const [user, authError] = await requireExtensionAuth(request)
  if (authError) return authError

  const [body, bodyError] = await readExtensionJsonBody<TelemetryBody>(request)
  if (bodyError) return bodyError

  const stage = sanitizeStage(body.stage)
  const fieldsFilled = sanitizeCount(body.fieldsFilled, 0)
  const fieldsTotalRaw = sanitizeCount(body.fieldsTotal, 0)
  const fieldsTotal = Math.max(fieldsTotalRaw, fieldsFilled, 1)
  const manualReviewCount = sanitizeCount(body.manualReviewCount, 0)
  const ats = normalizeAts(sanitizeText(body.atsType, 80))
  const companyName = sanitizeText(body.companyName, 180)
  const jobTitle = sanitizeText(body.jobTitle, 220)
  const errorMessage = sanitizeText(body.errorMessage, 320)
  const pageUrl = sanitizeText(body.pageUrl, 1200)
  const fallbackUsed = body.fallbackUsed === true
  const fillRate = Math.round((fieldsFilled / fieldsTotal) * 100)
  const jobId = sanitizeUuid(body.jobId)

  try {
    const pool = getPostgresPool()

    const featureKeys = [
      `ext_autofill_stage_${stage}`,
      `ext_autofill_ats_${ats}`,
    ]
    if (stage !== "preview") featureKeys.push("ext_autofill_attempt")
    if (stage === "success") featureKeys.push("ext_autofill_success")
    if (stage === "partial") featureKeys.push("ext_autofill_partial")
    if (stage === "error") featureKeys.push("ext_autofill_error")

    await Promise.all(featureKeys.map((key) => bumpFeatureUsage(user.sub, key)))

    if (stage !== "preview") {
      await pool.query(
        `INSERT INTO autofill_history (
          user_id,
          job_id,
          company_name,
          job_title,
          ats_type,
          fields_filled,
          fields_total,
          fill_rate,
          applied_at
        ) VALUES ($1::uuid, $2::uuid, $3::text, $4::text, $5::text, $6::int, $7::int, $8::numeric, now())`,
        [
          user.sub,
          jobId ?? null,
          companyName,
          jobTitle ?? `Extension autofill (${stage})`,
          `${ats}:${stage}`,
          fieldsFilled,
          fieldsTotal,
          fillRate,
        ],
      )
    }

    if (jobId && stage !== "preview") {
      await appendApplicationTimeline({
        userId: user.sub,
        jobId,
        stage,
        ats,
        fieldsFilled,
        fieldsTotal,
        manualReviewCount,
        errorMessage: errorMessage ?? pageUrl,
        fallbackUsed,
      }).catch(() => null)
    }

    return NextResponse.json(
      { ok: true },
      { headers: corsHeaders },
    )
  } catch (err) {
    console.error("[extension/autofill/telemetry] failed:", err)
    return extensionError(request, 500, "Failed to persist autofill telemetry", {
      headers: corsHeaders,
    })
  }
}
