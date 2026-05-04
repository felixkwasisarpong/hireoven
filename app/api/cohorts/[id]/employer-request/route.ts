import { NextResponse } from "next/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { aggregateCohortStats } from "@/lib/cohorts/aggregator"

export const dynamic = "force-dynamic"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: cohortId } = await params

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const { companyName, contactEmail, rolesNeeded, headcountRequested, message, companyId } = body

  if (!companyName || typeof companyName !== "string") {
    return NextResponse.json({ error: "companyName is required" }, { status: 400 })
  }
  if (!contactEmail || typeof contactEmail !== "string" || !contactEmail.includes("@")) {
    return NextResponse.json({ error: "A valid contactEmail is required" }, { status: 400 })
  }
  if (!Array.isArray(rolesNeeded) || rolesNeeded.length === 0) {
    return NextResponse.json({ error: "rolesNeeded must be a non-empty array" }, { status: 400 })
  }

  const pool = getPostgresPool()

  // Verify cohort exists
  const cohortCheck = await pool.query<{ id: string }>(
    `SELECT id FROM public.layoff_cohorts WHERE id = $1 AND status != 'closed'`,
    [cohortId]
  )
  if (!cohortCheck.rows.length) {
    return NextResponse.json({ error: "Cohort not found or no longer active" }, { status: 404 })
  }

  try {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO public.employer_cohort_requests
         (cohort_id, company_id, company_name, contact_email, roles_needed, headcount_requested, message, status)
       VALUES ($1, $2, $3, $4, $5::text[], $6, $7, 'pending')
       RETURNING id`,
      [
        cohortId,
        typeof companyId === "string" ? companyId : null,
        (companyName as string).trim(),
        (contactEmail as string).trim().toLowerCase(),
        rolesNeeded,
        typeof headcountRequested === "number" ? headcountRequested : 1,
        message ? String(message).trim() : null,
      ]
    )

    const requestId = result.rows[0].id

    aggregateCohortStats(cohortId).catch((err) =>
      console.error("[cohorts/employer-request] aggregation failed:", err instanceof Error ? err.message : err)
    )

    return NextResponse.json({ success: true, requestId })
  } catch (err) {
    console.error("[cohorts/employer-request] error:", err instanceof Error ? err.message : err)
    return NextResponse.json({ error: "Failed to submit employer request" }, { status: 500 })
  }
}
