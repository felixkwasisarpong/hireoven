import { NextResponse } from "next/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { createClient } from "@/lib/supabase/server"
import { aggregateCohortStats } from "@/lib/cohorts/aggregator"

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

  const { roleTitle, department, yearsExperience, currentSalary, skills, linkedinUrl, isVisible } = body

  if (!roleTitle || typeof roleTitle !== "string") {
    return NextResponse.json({ error: "roleTitle is required" }, { status: 400 })
  }
  if (!department || typeof department !== "string") {
    return NextResponse.json({ error: "department is required" }, { status: 400 })
  }
  if (typeof yearsExperience !== "number") {
    return NextResponse.json({ error: "yearsExperience must be a number" }, { status: 400 })
  }

  const pool = getPostgresPool()

  // Verify cohort exists and is not closed
  const cohortResult = await pool.query<{ id: string; status: string }>(
    `SELECT id, status FROM public.layoff_cohorts WHERE id = $1`,
    [cohortId]
  )
  if (!cohortResult.rows.length) {
    return NextResponse.json({ error: "Cohort not found" }, { status: 404 })
  }
  if (cohortResult.rows[0].status === "closed") {
    return NextResponse.json({ error: "This cohort is no longer accepting members" }, { status: 409 })
  }

  // Check not already a member
  const existingResult = await pool.query<{ id: string }>(
    `SELECT id FROM public.cohort_members WHERE cohort_id = $1 AND user_id = $2`,
    [cohortId, user.id]
  )
  if (existingResult.rows.length) {
    return NextResponse.json({ error: "Already a member of this cohort" }, { status: 409 })
  }

  try {
    const memberResult = await pool.query<{ id: string }>(
      `INSERT INTO public.cohort_members
         (cohort_id, user_id, role_title, department, years_experience, current_salary, skills, linkedin_url, is_visible)
       VALUES ($1, $2, $3, $4, $5, $6, $7::text[], $8, $9)
       RETURNING id`,
      [
        cohortId,
        user.id,
        (roleTitle as string).trim(),
        (department as string).trim(),
        yearsExperience,
        currentSalary ?? null,
        Array.isArray(skills) ? skills : [],
        linkedinUrl ?? null,
        isVisible !== false,
      ]
    )

    const memberId = memberResult.rows[0].id

    // Trigger aggregation async — don't block response
    aggregateCohortStats(cohortId).catch((err) =>
      console.error("[cohorts/join] aggregation failed:", err instanceof Error ? err.message : err)
    )

    const updatedCohort = await pool.query(
      `SELECT id, company_name, department, layoff_date, status, member_count, strength_score
       FROM public.layoff_cohorts WHERE id = $1`,
      [cohortId]
    )

    return NextResponse.json({ success: true, memberId, cohort: updatedCohort.rows[0] })
  } catch (err) {
    console.error("[cohorts/join] error:", err instanceof Error ? err.message : err)
    return NextResponse.json({ error: "Failed to join cohort" }, { status: 500 })
  }
}
