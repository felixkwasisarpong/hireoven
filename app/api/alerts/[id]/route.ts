import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres/server"
import type { JobAlertUpdate } from "@/types"

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const body = (await request.json().catch(() => ({}))) as JobAlertUpdate

  const allowed: Array<keyof JobAlertUpdate> = [
    "name", "keywords", "locations", "seniority_levels", "employment_types",
    "remote_only", "sponsorship_required", "company_ids", "is_active",
  ]

  const fields = Object.keys(body).filter((k) => allowed.includes(k as keyof JobAlertUpdate))
  if (fields.length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 })
  }

  const values: unknown[] = []
  const setClauses = fields.map((k) => {
    values.push((body as Record<string, unknown>)[k])
    const arrayFields = ["keywords", "locations", "seniority_levels", "employment_types", "company_ids"]
    return arrayFields.includes(k) ? `${k} = $${values.length}::text[]` : `${k} = $${values.length}`
  })
  values.push(id, user.id)

  const pool = getPostgresPool()
  const result = await pool.query(
    `UPDATE job_alerts
     SET ${setClauses.join(", ")}
     WHERE id = $${values.length - 1}
       AND user_id = $${values.length}
     RETURNING *`,
    values
  )

  if (result.rows.length === 0) {
    return NextResponse.json({ error: "Alert not found" }, { status: 404 })
  }

  return NextResponse.json({ alert: result.rows[0] })
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const pool = getPostgresPool()
  const result = await pool.query(
    `DELETE FROM job_alerts WHERE id = $1 AND user_id = $2 RETURNING id`,
    [id, user.id]
  )

  if (result.rows.length === 0) {
    return NextResponse.json({ error: "Alert not found" }, { status: 404 })
  }

  return NextResponse.json({ ok: true })
}
