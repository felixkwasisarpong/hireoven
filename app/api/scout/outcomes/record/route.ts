/**
 * POST /api/scout/outcomes/record
 *
 * Records a typed ScoutOutcome event to the scout_outcomes table.
 * Also updates the linked job_application status when the outcome implies
 * a status change (e.g., interview_received → status = "interview").
 *
 * Called by:
 *   - ScoutOutcomePicker when the user taps an outcome button
 *   - The browser extension when "Mark submitted" is clicked
 *   - Workflow engine when a workflow is abandoned
 *
 * Idempotent: a second call with the same applicationId + type is a no-op
 * (returns 200 with { duplicate: true }).
 */

import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { randomUUID } from "crypto"
import type { ScoutOutcomeType, ScoutOutcomeMeta } from "@/lib/scout/outcomes/types"
import { OUTCOME_TYPE_TO_APP_OUTCOME } from "@/lib/scout/outcomes/types"
import { inferRoleCategory, inferSector, inferWorkMode } from "@/lib/scout/outcomes/categorizers"

export const runtime = "nodejs"

type Body = {
  type:              ScoutOutcomeType
  applicationId?:    string | null
  relatedJobId?:     string | null
  relatedCompanyId?: string | null
  source?:           "manual" | "application_status" | "extension" | "workflow"
}

const VALID_OUTCOME_TYPES = new Set<ScoutOutcomeType>([
  "application_sent", "application_reviewed", "recruiter_reply",
  "interview_received", "interview_passed", "offer_received",
  "offer_accepted", "application_rejected", "workflow_abandoned",
])

// Which outcome types justify bumping the application status
const STATUS_UPDATE_TYPES = new Set<ScoutOutcomeType>([
  "recruiter_reply", "interview_received", "interview_passed",
  "offer_received", "offer_accepted", "application_rejected",
])

const STATUS_ORDER = [
  "saved", "applied", "phone_screen", "interview", "final_round",
  "offer", "rejected", "withdrawn",
]

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = (await request.json().catch(() => null)) as Body | null
  if (!body?.type || !VALID_OUTCOME_TYPES.has(body.type)) {
    return NextResponse.json({ error: "Valid 'type' is required" }, { status: 400 })
  }

  const pool = getPostgresPool()
  const now  = new Date().toISOString()
  const source = body.source ?? "manual"

  // ── Deduplication check ───────────────────────────────────────────────────
  if (body.applicationId) {
    const existing = await pool.query<{ id: string }>(
      `SELECT id FROM scout_outcomes
       WHERE user_id = $1 AND application_id = $2 AND type = $3
       LIMIT 1`,
      [user.id, body.applicationId, body.type],
    ).catch(() => null)

    if ((existing?.rowCount ?? 0) > 0) {
      return NextResponse.json({ ok: true, duplicate: true })
    }
  }

  // ── Derive metadata from application / job record ─────────────────────────
  let meta: ScoutOutcomeMeta = {}
  let jobId = body.relatedJobId ?? null
  let companyId = body.relatedCompanyId ?? null

  if (body.applicationId) {
    const appRow = await pool.query<{
      job_id: string | null
      company_id: string | null
      job_title: string | null
      company_name: string | null
      is_remote: boolean | null
      location: string | null
      industry: string | null
    }>(
      `SELECT ja.job_id, j.company_id, ja.job_title, ja.company_name,
              j.is_remote, j.location, c.industry
       FROM job_applications ja
       LEFT JOIN jobs      j ON j.id = ja.job_id
       LEFT JOIN companies c ON c.id = j.company_id
       WHERE ja.id = $1 AND ja.user_id = $2 LIMIT 1`,
      [body.applicationId, user.id],
    ).catch(() => null)

    const row = appRow?.rows?.[0]
    if (row) {
      jobId     = jobId     ?? row.job_id
      companyId = companyId ?? row.company_id

      meta = {
        roleCategory:       inferRoleCategory(row.job_title ?? ""),
        sector:             inferSector(row.job_title ?? "", row.company_name ?? "", row.industry),
        workMode:           inferWorkMode(row.is_remote, row.job_title ?? "", row.location),
        sponsorshipRelated: false, // only set explicitly or from extension context
      }
    }
  }

  // ── Insert outcome event ──────────────────────────────────────────────────
  await pool.query(
    `INSERT INTO scout_outcomes
       (id, user_id, type, application_id, related_job_id, related_company_id,
        role_category, sector, sponsorship_related, work_mode, source, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      randomUUID(), user.id, body.type,
      body.applicationId ?? null, jobId, companyId,
      meta.roleCategory ?? null, meta.sector ?? null,
      meta.sponsorshipRelated ?? false, meta.workMode ?? null,
      source, now,
    ],
  ).catch((err) => {
    console.error("[scout/outcomes/record] insert failed", err)
    throw err
  })

  // ── Optionally advance application status ─────────────────────────────────
  if (body.applicationId && STATUS_UPDATE_TYPES.has(body.type)) {
    const newStatus = OUTCOME_TYPE_TO_APP_OUTCOME[body.type]
    const currentRow = await pool.query<{ status: string; timeline: unknown[] | null }>(
      `SELECT status, timeline FROM job_applications WHERE id = $1 AND user_id = $2 LIMIT 1`,
      [body.applicationId, user.id],
    ).catch(() => null)

    const current = currentRow?.rows?.[0]
    if (current) {
      const curIdx = STATUS_ORDER.indexOf(current.status)
      const newIdx = STATUS_ORDER.indexOf(newStatus)

      const shouldUpdateStatus =
        newIdx > curIdx ||
        ["rejected", "withdrawn"].includes(newStatus)

      const timelineEntry = {
        id:     randomUUID(),
        type:   "status_change",
        status: shouldUpdateStatus ? newStatus : current.status,
        date:   now,
        auto:   false,
        note:   `Outcome recorded: ${body.type}`,
      }

      const timeline = [...((current.timeline ?? []) as unknown[]), timelineEntry]
      const updateFields: Record<string, unknown> = {
        timeline: JSON.stringify(timeline),
        updated_at: now,
      }
      if (shouldUpdateStatus) updateFields.status = newStatus

      const cols = Object.entries(updateFields)
      const vals: unknown[] = []
      const set = cols.map(([col, val]) => {
        vals.push(val)
        return `${col} = $${vals.length}${col === "timeline" ? "::jsonb" : ""}`
      })
      vals.push(body.applicationId, user.id)
      await pool.query(
        `UPDATE job_applications SET ${set.join(", ")} WHERE id = $${vals.length - 1} AND user_id = $${vals.length}`,
        vals,
      ).catch(() => {})
    }
  }

  console.log("[scout/outcomes/record]", { userId: user.id, type: body.type, appId: body.applicationId })

  return NextResponse.json({ ok: true, duplicate: false })
}
