import { randomUUID } from "crypto"
import { NextResponse } from "next/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { OUTCOME_TO_STATUS, type ApplicationOutcome } from "@/lib/apex/outcomes/types"
import { requireSignalApiAuth } from "@/lib/signal-api/auth"
import { signalApiError, signalApiJson } from "@/lib/signal-api/http"
import { logAndReturnSignalApiResponse } from "@/lib/signal-api/request-log"
import { emitSignalApiWebhookEvent } from "@/lib/signal-api/webhooks"

export const runtime = "nodejs"

type RecordOutcomeBody = {
  applicationId: string
  outcome: ApplicationOutcome
  evidence?: string[]
  notes?: string
}

export async function POST(request: Request) {
  const startedAtMs = Date.now()
  const auth = await requireSignalApiAuth(request, {
    requiredScopes: ["feedback.write"],
    requireUser: true,
  })
  if (auth instanceof NextResponse) return auth

  const finish = (response: Response) =>
    logAndReturnSignalApiResponse(request, auth, startedAtMs, response)

  const body = (await request.json().catch(() => null)) as RecordOutcomeBody | null
  if (!body?.applicationId || !body?.outcome) {
    return finish(signalApiError(
      400,
      "applicationId and outcome are required",
      "BAD_REQUEST",
      auth.requestId,
      auth.rateLimit, undefined, auth.quota
    ))
  }

  const { applicationId, outcome, evidence = [], notes } = body
  const pool = getPostgresPool()

  try {
    const current = await pool.query<{ status: string; timeline: unknown[] | null }>(
      `SELECT status, timeline
       FROM job_applications
       WHERE id = $1
         AND user_id = $2
       LIMIT 1`,
      [applicationId, auth.subjectUserId]
    )

    if (!current.rows[0]) {
      return finish(signalApiError(404, "Application not found", "NOT_FOUND", auth.requestId, auth.rateLimit, undefined, auth.quota))
    }

    const { status: currentStatus, timeline: currentTimeline } = current.rows[0]
    const newStatus = OUTCOME_TO_STATUS[outcome] ?? currentStatus
    const now = new Date().toISOString()

    const signalMeta: Record<string, unknown> = {
      source: "api",
      confidence: 1,
      outcome,
    }
    if (evidence.length > 0) signalMeta.evidence = evidence

    const timelineEntry = {
      id: randomUUID(),
      type: "status_change",
      status: newStatus,
      date: now,
      auto: false,
      note:
        notes ??
        (OUTCOME_TO_STATUS[outcome] !== currentStatus
          ? `Outcome recorded: ${outcome}`
          : `Outcome marked: ${outcome} (no status change)`),
      signal: signalMeta,
    }

    const updatedTimeline = [...((currentTimeline as unknown[]) ?? []), timelineEntry]

    const updates: Record<string, unknown> = {
      timeline: JSON.stringify(updatedTimeline),
      updated_at: now,
    }

    const STATUS_ORDER = [
      "saved",
      "applied",
      "phone_screen",
      "interview",
      "final_round",
      "offer",
      "rejected",
      "withdrawn",
    ]
    const currentIdx = STATUS_ORDER.indexOf(currentStatus)
    const newIdx = STATUS_ORDER.indexOf(newStatus)
    if (newIdx > currentIdx || ["rejected", "withdrawn"].includes(newStatus)) {
      updates.status = newStatus
    }
    if (notes) updates.notes = notes

    const entries = Object.entries(updates)
    const values: unknown[] = []
    const setSql = entries.map(([key, value]) => {
      values.push(value)
      const cast = key === "timeline" ? "::jsonb" : ""
      return `${key} = $${values.length}${cast}`
    })
    values.push(applicationId, auth.subjectUserId)

    await pool.query(
      `UPDATE job_applications
       SET ${setSql.join(", ")}
       WHERE id = $${values.length - 1}
         AND user_id = $${values.length}`,
      values
    )

    try {
      await emitSignalApiWebhookEvent({
        tenantId: auth.tenantId,
        eventType: "signal.outcome_recorded",
        data: {
          applicationId,
          outcome,
          newStatus,
          subjectUserId: auth.subjectUserId,
          evidence,
          notes: notes ?? null,
        },
      })
    } catch (error) {
      console.error("[signal-api] webhook emit failed after outcome record", error)
    }

    return finish(signalApiJson(auth, { success: true, outcome, newStatus }))
  } catch (error) {
    console.error("[signal/v1/feedback/outcomes] error", error)
    return finish(signalApiError(500, "Unable to record outcome", "INTERNAL_ERROR", auth.requestId, auth.rateLimit, undefined, auth.quota))
  }
}
