/**
 * GET  /api/extension/apply-queue  — returns the user's current queue items from job_applications
 * POST /api/extension/apply-queue  — validate + pre-check a job before queueing
 *
 * This route is called by the extension background to:
 *   GET:  sync queue status for jobs that were previously submitted
 *   POST: run pre-flight checks (same gates as bulk-prepare) and return whether
 *         a job is safe to queue (no sponsorship blocker, apply URL present, etc.)
 */

import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres/server"

export const runtime = "nodejs"

// ── GET — list recent scout_bulk applications ──────────────────────────────────
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50", 10), 100)

  const pool = getPostgresPool()
  const result = await pool.query<{
    id: string
    job_id: string | null
    job_title: string | null
    company_name: string | null
    apply_url: string | null
    status: string
    applied_at: string | null
    created_at: string
  }>(
    `SELECT id, job_id, job_title, company_name, apply_url, status, applied_at, created_at
     FROM job_applications
     WHERE user_id = $1 AND source = 'scout_bulk' AND is_archived = false
     ORDER BY created_at DESC
     LIMIT $2`,
    [user.id, limit],
  ).catch(() => null)

  const applications = result?.rows ?? []
  return NextResponse.json({ applications })
}

// ── POST — pre-flight check for a candidate job ────────────────────────────────
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  type Body = {
    jobId?: string | null
    jobTitle: string
    company?: string | null
    applyUrl?: string | null
    sponsorshipSignal?: string | null
    matchScore?: number | null
  }

  const body = (await request.json().catch(() => null)) as Body | null
  if (!body?.jobTitle || !body?.applyUrl) {
    return NextResponse.json({ error: "jobTitle and applyUrl are required" }, { status: 400 })
  }

  // ── Gate 1: apply URL ────────────────────────────────────────────────────────
  if (!body.applyUrl.trim()) {
    return NextResponse.json({ eligible: false, failReason: "missing_apply_url" })
  }

  // ── Gate 2: explicit no-sponsorship blocker ──────────────────────────────────
  if (body.sponsorshipSignal) {
    const sig = body.sponsorshipSignal.toLowerCase()
    if (/\bno\b|\bnone\b|\bnot\b|\bdoes not sponsor\b|\bwithout sponsorship\b/.test(sig)) {
      return NextResponse.json({ eligible: false, failReason: "no_sponsorship_blocker" })
    }
  }

  // ── Gate 3: already applied ──────────────────────────────────────────────────
  if (body.jobId) {
    const pool = getPostgresPool()
    const existing = await pool.query<{ id: string }>(
      `SELECT id FROM job_applications
       WHERE user_id = $1 AND job_id = $2 AND status = 'applied' AND is_archived = false
       LIMIT 1`,
      [user.id, body.jobId],
    ).catch(() => null)

    if ((existing?.rowCount ?? 0) > 0) {
      return NextResponse.json({ eligible: false, failReason: "already_applied" })
    }
  }

  // ── Gate 4: resume present ───────────────────────────────────────────────────
  const pool = getPostgresPool()
  const resumeCheck = await pool.query<{ id: string }>(
    `SELECT id FROM resumes WHERE user_id = $1 AND is_primary = true AND parse_status = 'complete' LIMIT 1`,
    [user.id],
  ).catch(() => null)

  if (!resumeCheck?.rows?.length) {
    return NextResponse.json({
      eligible: true,
      warnings: [{ code: "missing_resume", message: "No primary resume found — upload one in Hireoven.", severity: "warning" }],
    })
  }

  return NextResponse.json({
    eligible: true,
    warnings: [],
  })
}
