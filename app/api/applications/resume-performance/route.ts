import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres/server"
import {
  RESPONSE_STATUSES,
  computeVariantPerformance,
  type VariantApplication,
} from "@/lib/applications/variant-performance"

export const runtime = "nodejs"

const RESPONSE_SET = new Set<string>(RESPONSE_STATUSES)

type Row = {
  resume_id: string
  resume_name: string | null
  status: string
  timeline: unknown
}

type TimelineEntry = { type?: string; status?: string }

/** A submitted app "got a response" if it is currently at — or ever reached — a
 *  phone screen or beyond. Checking the timeline catches callbacks that later
 *  ended in a rejection, which a current-status check alone would miss. */
function gotResponse(status: string, timelineRaw: unknown): boolean {
  if (RESPONSE_SET.has(status)) return true
  const timeline = Array.isArray(timelineRaw) ? (timelineRaw as TimelineEntry[]) : []
  return timeline.some((e) => e?.type === "status_change" && typeof e.status === "string" && RESPONSE_SET.has(e.status))
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const pool = getPostgresPool()
  const { rows } = await pool.query<Row>(
    `SELECT ja.resume_id, r.name AS resume_name, ja.status, ja.timeline
       FROM job_applications ja
       JOIN resumes r ON r.id = ja.resume_id
      WHERE ja.user_id = $1 AND ja.is_archived = false
        AND ja.status <> 'saved' AND ja.resume_id IS NOT NULL`,
    [user.id],
  )

  const apps: VariantApplication[] = rows.map((r) => ({
    resumeId: r.resume_id,
    resumeName: r.resume_name?.trim() || "Untitled resume",
    gotResponse: gotResponse(r.status, r.timeline),
  }))

  // How many applications could be attributed at all — surfaces the capture gap.
  const [totalSubmitted, primary] = await Promise.all([
    pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM job_applications
        WHERE user_id = $1 AND is_archived = false AND status <> 'saved'`,
      [user.id],
    ),
    pool.query<{ id: string }>(
      `SELECT id FROM resumes WHERE user_id = $1 AND is_primary = true LIMIT 1`,
      [user.id],
    ),
  ])

  return NextResponse.json({
    ...computeVariantPerformance(apps),
    attributed: apps.length,
    submitted: totalSubmitted.rows[0]?.n ?? 0,
    primaryResumeId: primary.rows[0]?.id ?? null,
  })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = (await request.json().catch(() => ({}))) as { promoteResumeId?: string }
  const resumeId = body.promoteResumeId
  if (!resumeId) return NextResponse.json({ error: "promoteResumeId required" }, { status: 400 })

  const pool = getPostgresPool()
  // Single statement: winner → primary, everyone else → not. Atomic.
  const res = await pool.query(
    `UPDATE resumes SET is_primary = (id = $2), updated_at = NOW() WHERE user_id = $1`,
    [user.id, resumeId],
  )
  if (!res.rowCount) return NextResponse.json({ error: "No resumes to update" }, { status: 404 })
  return NextResponse.json({ ok: true, promoted: resumeId })
}
