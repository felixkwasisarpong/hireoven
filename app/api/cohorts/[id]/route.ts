import { NextResponse } from "next/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const pool = getPostgresPool()

  // Determine caller identity (optional — affects member visibility)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const callerId = user?.id ?? null

  try {
    const cohortResult = await pool.query<{
      id: string
      company_id: string
      company_name: string
      department: string | null
      layoff_date: string
      status: string
      member_count: number
      avg_years_experience: number | null
      avg_salary_usd: number | null
      strength_score: number
      top_skills: string[]
      employer_request_count: number
      created_at: string
    }>(
      `SELECT id, company_id, company_name, department, layoff_date, status,
              member_count, avg_years_experience, avg_salary_usd, strength_score,
              top_skills, employer_request_count, created_at
       FROM public.layoff_cohorts WHERE id = $1`,
      [id]
    )

    if (!cohortResult.rows.length) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const cohort = cohortResult.rows[0]

    // Check if caller is a member — determines anonymization level
    let callerIsMember = false
    if (callerId) {
      const memberCheck = await pool.query<{ id: string }>(
        `SELECT id FROM public.cohort_members WHERE cohort_id = $1 AND user_id = $2`,
        [id, callerId]
      )
      callerIsMember = memberCheck.rows.length > 0
    }

    // Fetch members — full details for members, anonymized for non-members
    const membersResult = await pool.query<{
      id: string
      user_id: string
      role_title: string
      department: string
      years_experience: number
      current_salary: number | null
      skills: string[]
      linkedin_url: string | null
      is_visible: boolean
      vouches_received: number
      vouches_given: number
      joined_at: string
      full_name: string | null
    }>(
      `SELECT
         cm.id, cm.user_id, cm.role_title, cm.department, cm.years_experience,
         cm.current_salary, cm.skills, cm.linkedin_url, cm.is_visible,
         cm.vouches_received, cm.vouches_given, cm.joined_at,
         p.full_name
       FROM public.cohort_members cm
       JOIN public.profiles p ON p.id = cm.user_id
       WHERE cm.cohort_id = $1 AND cm.is_visible = true
       ORDER BY cm.vouches_received DESC, cm.joined_at ASC`,
      [id]
    )

    // Anonymize: non-members see "First L." only
    const members = membersResult.rows.map((m) => {
      const isOwn = m.user_id === callerId
      if (callerIsMember || isOwn) return m

      const parts = (m.full_name ?? "").trim().split(" ")
      const anonName =
        parts.length >= 2
          ? `${parts[0]} ${parts[parts.length - 1].charAt(0)}.`
          : parts[0] || "Member"

      return {
        ...m,
        full_name: anonName,
        linkedin_url: null,
        current_salary: null,
        user_id: null,
      }
    })

    // Employer requests
    const requestsResult = await pool.query<{
      id: string
      company_name: string
      roles_needed: string[]
      headcount_requested: number
      message: string | null
      status: string
      created_at: string
    }>(
      `SELECT id, company_name, roles_needed, headcount_requested, message, status, created_at
       FROM public.employer_cohort_requests
       WHERE cohort_id = $1 AND status != 'closed'
       ORDER BY created_at DESC`,
      [id]
    )

    return NextResponse.json({
      cohort,
      members,
      employerRequests: requestsResult.rows,
      callerIsMember,
    })
  } catch (err) {
    console.error("[cohorts/[id]] error:", err instanceof Error ? err.message : err)
    return NextResponse.json({ error: "Failed to fetch cohort" }, { status: 500 })
  }
}
