/**
 * GET /api/scout/outcomes  — compute learning signals from application history
 * POST /api/scout/outcomes — record an outcome for a specific application
 *
 * GET response: OutcomeLearningResult (signals + feedback needed + stats)
 * POST body:    { applicationId, outcome, evidence?, notes? }
 * POST action:  PATCH job_applications status + append timeline entry
 *
 * No new DB tables. Uses existing job_applications schema.
 * s-maxage=1800 on GET (learning signals change slowly).
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { randomUUID } from "crypto"
import { computeOutcomeLearning, type LearningApplicationRow } from "@/lib/scout/outcomes/learning"
import type { ApplicationOutcome } from "@/lib/scout/outcomes/types"
import { OUTCOME_TO_STATUS } from "@/lib/scout/outcomes/types"

export const runtime = "nodejs"

// ── GET — compute learning signals ───────────────────────────────────────────

export async function GET(_request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const pool = getPostgresPool()

  const result = await pool.query<LearningApplicationRow>(
    `SELECT
       ja.id, ja.job_title, ja.company_name, ja.status, ja.apply_url,
       ja.match_score, ja.source, ja.applied_at, ja.notes,
       j.is_remote
     FROM job_applications ja
     LEFT JOIN jobs j ON j.id = ja.job_id
     WHERE ja.user_id = $1
       AND ja.is_archived = false
       AND ja.status != 'saved'
     ORDER BY ja.applied_at DESC
     LIMIT 200`,
    [user.id]
  ).catch(() => null)

  const apps: LearningApplicationRow[] = result?.rows ?? []
  const learning = computeOutcomeLearning(apps)

  console.log("[scout/outcomes] GET", { userId: user.id, apps: apps.length, signals: learning.signals.length })

  return NextResponse.json(learning, {
    headers: { "Cache-Control": "s-maxage=1800, stale-while-revalidate=3600" },
  })
}

// ── POST — record an outcome ──────────────────────────────────────────────────

type RecordOutcomeBody = {
  applicationId: string
  outcome:       ApplicationOutcome
  evidence?:     string[]
  notes?:        string
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = (await request.json().catch(() => null)) as RecordOutcomeBody | null
  if (!body?.applicationId || !body?.outcome) {
    return NextResponse.json({ error: "applicationId and outcome required" }, { status: 400 })
  }

  const { applicationId, outcome, evidence = [], notes } = body
  const pool = getPostgresPool()

  // Fetch current application
  const current = await pool.query<{ status: string; timeline: unknown[] | null }>(
    `SELECT status, timeline FROM job_applications WHERE id = $1 AND user_id = $2 LIMIT 1`,
    [applicationId, user.id]
  ).catch(() => null)

  if (!current?.rows?.[0]) {
    return NextResponse.json({ error: "Application not found" }, { status: 404 })
  }

  const { status: currentStatus, timeline: currentTimeline } = current.rows[0]
  const newStatus = OUTCOME_TO_STATUS[outcome] ?? currentStatus
  const now = new Date().toISOString()

  // Build timeline entry with outcome signal metadata in note
  const signalMeta: Record<string, unknown> = {
    source:     "manual",
    confidence: 1.0,
    outcome,
  }
  if (evidence.length > 0) signalMeta.evidence = evidence

  const timelineEntry = {
    id:     randomUUID(),
    type:   "status_change",
    status: newStatus,
    date:   now,
    auto:   false,
    note:   notes ?? OUTCOME_TO_STATUS[outcome] !== currentStatus
      ? `Outcome recorded: ${outcome}`
      : `Outcome marked: ${outcome} (no status change)`,
    signal: signalMeta,  // stored in timeline entry for future retrieval
  }

  const updatedTimeline = [...((currentTimeline as unknown[]) ?? []), timelineEntry]
  const updates: Record<string, unknown> = {
    timeline:   JSON.stringify(updatedTimeline),
    updated_at: now,
  }

  // Only change status if it's a meaningful progression
  const STATUS_ORDER = ["saved", "applied", "phone_screen", "interview", "final_round", "offer", "rejected", "withdrawn"]
  const currentIdx  = STATUS_ORDER.indexOf(currentStatus)
  const newIdx      = STATUS_ORDER.indexOf(newStatus)
  if (newIdx > currentIdx || ["rejected", "withdrawn"].includes(newStatus)) {
    updates.status = newStatus
    if (newStatus === "interview" || newStatus === "phone_screen") {
      // Don't overwrite applied_at — that's when they applied, not when they were interviewed
    }
  }

  if (notes) updates.notes = notes

  const entries = Object.entries(updates)
  const values: unknown[] = []
  const setSql = entries.map(([key, val]) => {
    values.push(key === "timeline" ? val : val)
    const cast = key === "timeline" ? "::jsonb" : ""
    return `${key} = $${values.length}${cast}`
  })
  values.push(applicationId, user.id)

  await pool.query(
    `UPDATE job_applications SET ${setSql.join(", ")} WHERE id = $${values.length - 1} AND user_id = $${values.length}`,
    values
  )

  console.log("[scout/outcomes] POST", { userId: user.id, applicationId, outcome, newStatus })

  return NextResponse.json({ success: true, outcome, newStatus })
}
