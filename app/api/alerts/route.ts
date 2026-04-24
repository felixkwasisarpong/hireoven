import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres/server"
import type { JobAlert, JobAlertInsert } from "@/types"

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const pool = getPostgresPool()
  const result = await pool.query<JobAlert>(
    `SELECT *
     FROM job_alerts
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [user.id]
  )

  return NextResponse.json({ alerts: result.rows })
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = (await request.json().catch(() => ({}))) as Partial<JobAlertInsert>

  if (!body.name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 })
  }

  const pool = getPostgresPool()
  const result = await pool.query<JobAlert>(
    `INSERT INTO job_alerts (
      user_id, name, keywords, locations, seniority_levels, employment_types,
      remote_only, sponsorship_required, company_ids, is_active
    ) VALUES ($1, $2, $3::text[], $4::text[], $5::text[], $6::text[], $7, $8, $9::uuid[], $10)
    RETURNING *`,
    [
      user.id,
      body.name,
      body.keywords ?? [],
      body.locations ?? [],
      body.seniority_levels ?? [],
      body.employment_types ?? [],
      body.remote_only ?? false,
      body.sponsorship_required ?? false,
      body.company_ids ?? [],
      body.is_active ?? true,
    ]
  )

  return NextResponse.json({ alert: result.rows[0] }, { status: 201 })
}
