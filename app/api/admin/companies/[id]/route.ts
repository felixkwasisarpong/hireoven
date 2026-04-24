import { NextRequest, NextResponse } from "next/server"
import { assertAdminAccess } from "@/lib/admin/auth"
import { getPostgresPool } from "@/lib/postgres/server"

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const access = await assertAdminAccess()
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const { id } = await params
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>

  const allowed = ["name", "domain", "ats_type", "careers_url", "logo_url", "industry",
    "is_active", "size", "sponsors_h1b", "sponsorship_confidence", "raw_ats_config",
    "job_count", "description"]
  const fields = Object.keys(body).filter((k) => allowed.includes(k))
  if (fields.length === 0) return NextResponse.json({ error: "No valid fields" }, { status: 400 })

  const values: unknown[] = []
  const setClauses = fields.map((k) => {
    values.push(k === "raw_ats_config" ? JSON.stringify(body[k]) : body[k])
    return k === "raw_ats_config" ? `${k} = $${values.length}::jsonb` : `${k} = $${values.length}`
  })
  values.push(id)

  const pool = getPostgresPool()
  const result = await pool.query(
    `UPDATE companies SET ${setClauses.join(", ")}, updated_at = now() WHERE id = $${values.length} RETURNING *`,
    values
  )
  if (result.rows.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json({ company: result.rows[0] })
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const access = await assertAdminAccess()
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const { id } = await params
  const pool = getPostgresPool()
  await pool.query(`DELETE FROM companies WHERE id = $1`, [id])
  return NextResponse.json({ ok: true })
}
