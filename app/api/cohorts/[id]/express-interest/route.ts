import { NextResponse } from "next/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: cohortId } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const { employerRequestId } = body
  if (!employerRequestId || typeof employerRequestId !== "string") {
    return NextResponse.json({ error: "employerRequestId is required" }, { status: 400 })
  }

  const pool = getPostgresPool()

  // Verify user is a member of this cohort
  const memberCheck = await pool.query<{ id: string }>(
    `SELECT id FROM public.cohort_members WHERE cohort_id = $1 AND user_id = $2`,
    [cohortId, user.id]
  )
  if (!memberCheck.rows.length) {
    return NextResponse.json({ error: "You must be a member of this cohort" }, { status: 403 })
  }

  // Verify the employer request belongs to this cohort
  const reqCheck = await pool.query<{ id: string }>(
    `SELECT id FROM public.employer_cohort_requests WHERE id = $1 AND cohort_id = $2`,
    [employerRequestId, cohortId]
  )
  if (!reqCheck.rows.length) {
    return NextResponse.json({ error: "Employer request not found" }, { status: 404 })
  }

  try {
    await pool.query(
      `INSERT INTO public.cohort_employer_interests
         (cohort_id, user_id, employer_request_id, status)
       VALUES ($1, $2, $3, 'interested')
       ON CONFLICT (user_id, employer_request_id)
       DO UPDATE SET status = 'interested', updated_at = now()`,
      [cohortId, user.id, employerRequestId]
    )
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error("[cohorts/express-interest] error:", err instanceof Error ? err.message : err)
    return NextResponse.json({ error: "Failed to record interest" }, { status: 500 })
  }
}
