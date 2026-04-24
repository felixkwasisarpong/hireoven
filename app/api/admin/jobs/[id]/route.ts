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

  const allowed = ["title", "location", "is_active", "is_remote", "seniority_level",
    "employment_type", "salary_min", "salary_max", "sponsors_h1b", "sponsorship_score",
    "normalized_title", "skills", "description"]
  const fields = Object.keys(body).filter((k) => allowed.includes(k))
  if (fields.length === 0) return NextResponse.json({ error: "No valid fields" }, { status: 400 })

  const arrayFields = new Set(["skills"])
  const values: unknown[] = []
  const setClauses = fields.map((k) => {
    values.push(body[k])
    return arrayFields.has(k) ? `${k} = $${values.length}::text[]` : `${k} = $${values.length}`
  })
  values.push(id)

  const pool = getPostgresPool()
  const result = await pool.query(
    `UPDATE jobs SET ${setClauses.join(", ")} WHERE id = $${values.length} RETURNING *`,
    values
  )
  if (result.rows.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json({ job: result.rows[0] })
}
