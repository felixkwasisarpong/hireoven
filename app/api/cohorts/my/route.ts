import { NextResponse } from "next/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const pool = getPostgresPool()

  try {
    const result = await pool.query<{
      cohort_id: string
      company_name: string
      department: string | null
      layoff_date: string
      status: string
      member_count: number
      strength_score: number
      employer_request_count: number
      top_skills: string[]
      member_id: string
      role_title: string
      member_department: string
      years_experience: number
      skills: string[]
      is_visible: boolean
      vouches_received: number
      vouches_given: number
      joined_at: string
    }>(
      `SELECT
         lc.id AS cohort_id,
         lc.company_name,
         lc.department,
         lc.layoff_date,
         lc.status,
         lc.member_count,
         lc.strength_score,
         lc.employer_request_count,
         lc.top_skills,
         cm.id AS member_id,
         cm.role_title,
         cm.department AS member_department,
         cm.years_experience,
         cm.skills,
         cm.is_visible,
         cm.vouches_received,
         cm.vouches_given,
         cm.joined_at
       FROM public.cohort_members cm
       JOIN public.layoff_cohorts lc ON lc.id = cm.cohort_id
       WHERE cm.user_id = $1
       ORDER BY cm.joined_at DESC`,
      [user.id]
    )

    // For each cohort, also fetch employer requests and user's interests
    const cohortIds = result.rows.map((r) => r.cohort_id)

    let employerRequests: Record<string, unknown[]> = {}
    let userInterests: Record<string, string> = {}

    if (cohortIds.length > 0) {
      const [reqResult, interestResult] = await Promise.all([
        pool.query<{
          id: string
          cohort_id: string
          company_name: string
          roles_needed: string[]
          headcount_requested: number
          message: string | null
          status: string
          created_at: string
        }>(
          `SELECT id, cohort_id, company_name, roles_needed, headcount_requested, message, status, created_at
           FROM public.employer_cohort_requests
           WHERE cohort_id = ANY($1::uuid[]) AND status != 'closed'
           ORDER BY created_at DESC`,
          [cohortIds]
        ),
        pool.query<{ employer_request_id: string; status: string }>(
          `SELECT employer_request_id, status
           FROM public.cohort_employer_interests
           WHERE user_id = $1 AND cohort_id = ANY($2::uuid[])`,
          [user.id, cohortIds]
        ),
      ])

      for (const req of reqResult.rows) {
        if (!employerRequests[req.cohort_id]) employerRequests[req.cohort_id] = []
        employerRequests[req.cohort_id].push(req)
      }

      for (const interest of interestResult.rows) {
        userInterests[interest.employer_request_id] = interest.status
      }
    }

    const cohorts = result.rows.map((row) => ({
      cohortId: row.cohort_id,
      companyName: row.company_name,
      department: row.department,
      layoffDate: row.layoff_date,
      status: row.status,
      memberCount: row.member_count,
      strengthScore: row.strength_score,
      employerRequestCount: row.employer_request_count,
      topSkills: row.top_skills,
      member: {
        id: row.member_id,
        roleTitle: row.role_title,
        department: row.member_department,
        yearsExperience: row.years_experience,
        skills: row.skills,
        isVisible: row.is_visible,
        vouchesReceived: row.vouches_received,
        vouchesGiven: row.vouches_given,
        joinedAt: row.joined_at,
      },
      employerRequests: employerRequests[row.cohort_id] ?? [],
      userInterests,
    }))

    return NextResponse.json({ cohorts })
  } catch (err) {
    console.error("[cohorts/my] error:", err instanceof Error ? err.message : err)
    return NextResponse.json({ error: "Failed to fetch your cohorts" }, { status: 500 })
  }
}
