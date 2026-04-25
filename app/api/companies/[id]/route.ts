import { NextRequest, NextResponse } from "next/server"
import { sqlJobLocatedInUsa } from "@/lib/jobs/usa-job-sql"
import { getPostgresPool } from "@/lib/postgres/server"
import type { Company, Job } from "@/types"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const pool = getPostgresPool()

  const [companyResult, jobsResult] = await Promise.all([
    pool.query<Company>(
      `SELECT * FROM companies WHERE id = $1 LIMIT 1`,
      [id]
    ),
    pool.query<Job>(
      `SELECT *
       FROM jobs
       WHERE company_id = $1
         AND is_active = true
         AND ${sqlJobLocatedInUsa("jobs")}
       ORDER BY first_detected_at DESC
       LIMIT 50`,
      [id]
    ),
  ])

  const company = companyResult.rows[0] ?? null
  if (!company) {
    return NextResponse.json({ error: "Company not found" }, { status: 404 })
  }

  return NextResponse.json({ company, jobs: jobsResult.rows })
}
