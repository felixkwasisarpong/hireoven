/**
 * POST /api/extension/applications/proof
 *
 * Records that the user manually submitted an application for a saved job.
 * Flips the existing job_applications row to status='applied', records the
 * submitted-at timestamp, appends a timeline entry with the confirmation
 * text the bar captured from the page, and links the resume + cover letter
 * versions used (when known).
 *
 * Safe by design:
 *   - Never auto-submits anything; we only record what the user already did.
 *   - No screenshots in this step (the bar passes confirmationText only).
 *   - Idempotent on (user_id, job_id) — repeated submits update timestamps
 *     but only append a new timeline entry on the first save.
 *
 * Auth: Bearer <ho_session JWT> sent by the Chrome extension.
 */

import { NextResponse } from "next/server"
import { randomUUID } from "crypto"
import { getPostgresPool } from "@/lib/postgres/server"
import {
  extensionCorsHeaders,
  extensionError,
  handleExtensionPreflight,
  readExtensionJsonBody,
  requireExtensionAuth,
} from "@/lib/extension/auth"
import type { JobApplication, TimelineEntry } from "@/types"

export const runtime = "nodejs"
export const maxDuration = 15

interface ProofBody {
  jobId?: string
  jobUrl?: string
  applyUrl?: string
  ats?: string
  submittedAt?: string
  confirmationText?: string
  resumeVersionId?: string
  coverLetterId?: string
}

export function OPTIONS(request: Request) {
  return handleExtensionPreflight(request)
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin")
  const headers = extensionCorsHeaders(origin)

  const [user, errResponse] = await requireExtensionAuth(request)
  if (errResponse) return errResponse

  const [body, bodyError] = await readExtensionJsonBody<ProofBody>(request)
  if (bodyError) return bodyError

  const submittedAt = parseTimestamp(body.submittedAt) ?? new Date().toISOString()
  const confirmationText = (body.confirmationText ?? "").trim().slice(0, 1000)
  const ats = (body.ats ?? "").trim().slice(0, 32) || null

  const pool = getPostgresPool()

  // ── Resolve the application row ───────────────────────────────────────────
  // Prefer jobId. Fall back to URL match against jobs.url / jobs.canonical_url
  // so the bar can call us even on a bare confirmation page where /check
  // hasn't run.
  let application: JobApplication | null = null

  if (body.jobId) {
    const r = await pool.query<JobApplication>(
      `SELECT * FROM job_applications WHERE user_id = $1 AND job_id = $2 LIMIT 1`,
      [user.sub, body.jobId],
    )
    application = r.rows[0] ?? null
  }

  if (!application && body.jobUrl) {
    const r = await pool.query<JobApplication>(
      `SELECT a.*
         FROM job_applications a
         JOIN jobs j ON j.id = a.job_id
        WHERE a.user_id = $1
          AND (j.url = $2 OR j.canonical_url = $2 OR j.apply_url = $2)
        LIMIT 1`,
      [user.sub, body.jobUrl],
    )
    application = r.rows[0] ?? null
  }

  if (!application) {
    return extensionError(
      request,
      404,
      "No saved job found — save the job first, then mark it as submitted.",
      { headers },
    )
  }

  // ── Build the proof timeline entry (deduped on repeated calls) ───────────
  const existingTimeline: TimelineEntry[] = Array.isArray(application.timeline) ? application.timeline : []
  const alreadyHasProofEntry = existingTimeline.some(
    (t) => t.type === "status_change" && t.status === "applied" && t.auto === true,
  )

  const proofEntry: TimelineEntry = {
    id: randomUUID(),
    type: "status_change",
    status: "applied",
    note: confirmationText
      ? `Application submitted${ats ? ` via ${ats}` : ""}. ${confirmationText}`
      : `Application submitted${ats ? ` via ${ats}` : ""}.`,
    date: submittedAt,
    auto: true,
  }

  const timeline = alreadyHasProofEntry ? existingTimeline : [...existingTimeline, proofEntry]

  // ── Update the row ────────────────────────────────────────────────────────
  // Only flip status to 'applied' when it's still in 'saved' — don't downgrade
  // an already-progressed app (e.g. user got a phone screen, then re-visited
  // the confirmation page).
  const newStatus = application.status === "saved" ? "applied" : application.status
  const appliedAt = application.applied_at ?? submittedAt

  const update = await pool.query<JobApplication>(
    `UPDATE job_applications
        SET status        = $1,
            applied_at    = $2,
            timeline      = $3::jsonb,
            resume_id     = COALESCE($4, resume_id),
            cover_letter_id = COALESCE($5, cover_letter_id),
            updated_at    = NOW()
      WHERE id = $6 AND user_id = $7
      RETURNING *`,
    [
      newStatus,
      appliedAt,
      JSON.stringify(timeline),
      body.resumeVersionId ?? null,
      body.coverLetterId ?? null,
      application.id,
      user.sub,
    ],
  )

  const updated = update.rows[0]
  if (!updated) {
    return extensionError(request, 500, "Failed to record application proof", { headers })
  }

  return NextResponse.json(
    {
      ok: true,
      applicationId: updated.id,
      status: updated.status,
      appliedAt: updated.applied_at,
      alreadyRecorded: alreadyHasProofEntry,
    },
    { headers },
  )
}

function parseTimestamp(value: string | undefined): string | null {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}
