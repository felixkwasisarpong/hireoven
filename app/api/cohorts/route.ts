import { NextResponse } from "next/server"
import { getPostgresPool } from "@/lib/postgres/server"

export const dynamic = "force-dynamic"

export type CohortListItem = {
  id: string
  company_name: string
  department: string | null
  layoff_date: string
  member_count: number
  avg_years_experience: number | null
  avg_salary_usd: number | null
  strength_score: number
  top_skills: string[]
  employer_request_count: number
  status: string
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const department = searchParams.get("department")
  const companyId = searchParams.get("companyId")

  const pool = getPostgresPool()

  const conditions: string[] = ["status != 'closed'"]
  const params: unknown[] = []
  let idx = 1

  if (department) {
    conditions.push(`department ILIKE $${idx}`)
    params.push(department)
    idx++
  }
  if (companyId) {
    conditions.push(`company_id = $${idx}`)
    params.push(companyId)
    idx++
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""

  try {
    const result = await pool.query<CohortListItem>(
      `SELECT
         id, company_name, department, layoff_date, member_count,
         avg_years_experience, avg_salary_usd, strength_score,
         top_skills, employer_request_count, status
       FROM public.layoff_cohorts
       ${where}
       ORDER BY strength_score DESC, member_count DESC
       LIMIT 50`,
      params
    )
    return NextResponse.json({ cohorts: result.rows })
  } catch (err) {
    console.error("[cohorts] list error:", err instanceof Error ? err.message : err)
    return NextResponse.json({ error: "Failed to fetch cohorts" }, { status: 500 })
  }
}
