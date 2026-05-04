import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { completeCheckin } from "@/lib/checkins/delivery-engine"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let body: unknown
  try { body = await request.json() } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }) }

  const { hiredOutcomeId, exitStatus, leftAt, responses } = body as {
    hiredOutcomeId?: string
    exitStatus?: string
    leftAt?: string
    responses?: Record<string, unknown>
  }

  if (!hiredOutcomeId) return NextResponse.json({ error: "hiredOutcomeId required" }, { status: 400 })

  const validExitStatuses = new Set(["left_voluntarily", "laid_off", "fired", "promoted"])
  if (!exitStatus || !validExitStatuses.has(exitStatus)) {
    return NextResponse.json({ error: "Invalid exitStatus" }, { status: 400 })
  }

  const pool = getPostgresPool()

  // Verify ownership
  const ownerCheck = await pool.query<{ id: string; company_id: string | null }>(
    `SELECT id, company_id FROM public.hired_outcomes WHERE id = $1 AND user_id = $2`,
    [hiredOutcomeId, user.id]
  )
  if (!ownerCheck.rows.length) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const companyId = ownerCheck.rows[0].company_id

  // Update hired_outcome
  await pool.query(
    `UPDATE public.hired_outcomes
     SET current_status = $1, left_at = $2, updated_at = now()
     WHERE id = $3 AND user_id = $4`,
    [exitStatus, leftAt ?? new Date().toISOString().split("T")[0], hiredOutcomeId, user.id]
  )

  // Create and immediately complete exit check-in if responses provided
  if (responses && Object.keys(responses).length > 0) {
    const checkinResult = await pool.query<{ id: string }>(
      `INSERT INTO public.post_hire_checkins
         (hired_outcome_id, user_id, company_id, checkin_type, scheduled_at)
       VALUES ($1, $2, $3, 'exit', now())
       RETURNING id`,
      [hiredOutcomeId, user.id, companyId]
    )
    const checkinId = checkinResult.rows[0].id
    await completeCheckin(checkinId, user.id, responses)
  }

  // If laid off: check for existing cohort or trigger cohort detection
  if (exitStatus === "laid_off" && companyId) {
    try {
      const { detectAndCreateCohorts } = await import("@/lib/cohorts/cohort-detector")
      await detectAndCreateCohorts()
    } catch { /* non-blocking */ }

    // Update company_layoff_summary with user-reported data
    try {
      await pool.query(
        `INSERT INTO public.company_layoff_summary (company_id, total_layoff_events, most_recent_layoff_date, last_computed_at, updated_at)
         VALUES ($1, 1, CURRENT_DATE, now(), now())
         ON CONFLICT (company_id) DO UPDATE SET
           total_layoff_events = company_layoff_summary.total_layoff_events + 1,
           most_recent_layoff_date = GREATEST(company_layoff_summary.most_recent_layoff_date, CURRENT_DATE),
           updated_at = now()`,
        [companyId]
      )
    } catch { /* non-blocking */ }
  }

  // Check for cohort membership to surface to user
  let cohortId: string | null = null
  if (companyId) {
    const cohortResult = await pool.query<{ id: string }>(
      `SELECT id FROM public.layoff_cohorts
       WHERE company_id = $1 AND status IN ('forming', 'active', 'matching')
       ORDER BY created_at DESC LIMIT 1`,
      [companyId]
    )
    cohortId = cohortResult.rows[0]?.id ?? null
  }

  return NextResponse.json({ ok: true, cohortId })
}
