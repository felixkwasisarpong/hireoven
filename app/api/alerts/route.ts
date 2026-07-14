import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres/server"
import type { JobAlert, JobAlertInsert } from "@/types"
import { getPlanForUserId } from "@/lib/gates/server-gate"
import { SOFT_LIMITS } from "@/lib/gates/index"

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

  const plan = await getPlanForUserId(user.id)
  if (plan === "free") {
    const countResult = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM job_alerts WHERE user_id = $1`,
      [user.id]
    )
    const current = parseInt(countResult.rows[0]?.count ?? "0", 10)
    const limit = SOFT_LIMITS.basic_alerts ?? 3
    if (current >= limit) {
      return NextResponse.json(
        { error: `Free plan is limited to ${limit} job alerts. Upgrade to Pro for unlimited.`, code: "QUOTA_EXCEEDED", limit },
        { status: 429 }
      )
    }
  }

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

  // Creating an alert is the explicit opt-in signal — flip email_alerts on so
  // the scheduled alert email pipeline can include this user. Best-effort
  // (we don't fail alert creation if the profile update errors).
  try {
    await pool.query(
      `UPDATE profiles SET email_alerts = true, updated_at = now() WHERE id = $1`,
      [user.id]
    )
  } catch {
    // ignore — user can flip it manually in settings
  }

  return NextResponse.json({ alert: result.rows[0] }, { status: 201 })
}
