/**
 * POST /api/scout/mark-submitted
 *
 * Called when the user clicks "Mark submitted manually" in the review
 * drawer or extension panel. Looks up (or creates) the job_applications
 * row and sets status → "applied". Never auto-submits anything.
 */

import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { randomUUID } from "crypto"

export const runtime = "nodejs"

type Body = {
  jobId?:          string
  applicationId?:  string
  jobTitle?:       string
  companyName?:    string
  applyUrl?:       string
  notes?:          string
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = (await request.json().catch(() => null)) as Body | null
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 })

  const { jobId, applicationId, jobTitle, companyName, applyUrl, notes } = body
  if (!jobId && !applicationId) {
    return NextResponse.json({ error: "jobId or applicationId required" }, { status: 400 })
  }

  const pool = getPostgresPool()
  const now = new Date().toISOString()

  // ── Find existing application ─────────────────────────────────────────────────
  let appId = applicationId ?? null

  if (!appId && jobId) {
    const existing = await pool.query<{ id: string }>(
      `SELECT id FROM job_applications
       WHERE user_id = $1 AND job_id = $2 AND is_archived = false
       ORDER BY created_at DESC LIMIT 1`,
      [user.id, jobId]
    ).catch(() => null)
    appId = existing?.rows?.[0]?.id ?? null
  }

  const timelineEntry = {
    id:     randomUUID(),
    type:   "status_change",
    status: "applied",
    date:   now,
    auto:   false,
    note:   notes ?? "Marked submitted manually via Scout review panel",
  }

  // ── Update existing row ───────────────────────────────────────────────────────
  if (appId) {
    const current = await pool.query<{ timeline: unknown[] | null }>(
      `SELECT timeline FROM job_applications WHERE id = $1 AND user_id = $2 LIMIT 1`,
      [appId, user.id]
    ).catch(() => null)
    const timeline = [...((current?.rows?.[0]?.timeline ?? []) as unknown[]), timelineEntry]

    await pool.query(
      `UPDATE job_applications
       SET status = 'applied', applied_at = $1, timeline = $2::jsonb, updated_at = $3
       WHERE id = $4 AND user_id = $5`,
      [now, JSON.stringify(timeline), now, appId, user.id]
    )
    console.log("[mark-submitted] updated", { userId: user.id, appId })
  return NextResponse.json({ success: true, applicationId: appId, created: false })
  }

  // ── Create new row if no existing application ─────────────────────────────────
  if (!jobTitle || !companyName) {
    return NextResponse.json(
      { error: "jobTitle and companyName required to create a new application" },
      { status: 400 }
    )
  }

  const newId = randomUUID()
  await pool.query(
    `INSERT INTO job_applications
       (id, user_id, job_id, job_title, company_name, apply_url,
        status, applied_at, source, timeline, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'applied', $7, 'scout_bulk', $8::jsonb, $9, $9)`,
    [
      newId, user.id, jobId ?? null,
      jobTitle, companyName, applyUrl ?? null,
      now, JSON.stringify([timelineEntry]), now,
    ]
  )

  return NextResponse.json({ success: true, applicationId: newId, created: true })
}
