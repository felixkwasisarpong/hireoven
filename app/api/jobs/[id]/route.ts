import { NextRequest, NextResponse } from "next/server"
import { sqlJobLocatedInUsa } from "@/lib/jobs/usa-job-sql"
import { getPostgresPool } from "@/lib/postgres/server"
import type { JobWithCompany } from "@/types"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const pool = getPostgresPool()

  const result = await pool.query<JobWithCompany>(
    `SELECT j.*, to_jsonb(c.*) AS company
     FROM jobs j
     LEFT JOIN companies c ON c.id = j.company_id
     WHERE j.id = $1 AND ${sqlJobLocatedInUsa("j")}
     LIMIT 1`,
    [id]
  )

  const job = result.rows[0] ?? null
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 })
  }

  return NextResponse.json({ job })
}
