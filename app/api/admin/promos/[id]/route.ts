import { NextResponse } from "next/server"
import { assertAdminAccess } from "@/lib/admin/auth"
import { getPostgresPool } from "@/lib/postgres/server"
import type { PromoRow } from "../route"

export const runtime = "nodejs"

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const access = await assertAdminAccess()
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const { id } = await params

  let body: Partial<PromoRow>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Could not parse request body" }, { status: 400 })
  }

  const allowed = ["title","subtitle","description","badge_label","is_new","theme","icon","cta_label","cta_url","is_active","starts_at","ends_at"] as const
  const fields = Object.keys(body).filter(k => (allowed as readonly string[]).includes(k))
  if (fields.length === 0) return NextResponse.json({ error: "No valid fields" }, { status: 400 })

  const pool = getPostgresPool()
  const values: unknown[] = []
  const setClauses = fields.map((k, i) => {
    values.push((body as Record<string, unknown>)[k])
    return `${k} = $${i + 1}`
  })
  values.push(id)

  const result = await pool.query<PromoRow>(
    `UPDATE promos SET ${setClauses.join(", ")}, updated_at = now()
     WHERE id = $${values.length} RETURNING *`,
    values
  )
  if (!result.rows[0]) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json({ promo: result.rows[0] })
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const access = await assertAdminAccess()
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const { id } = await params
  const pool = getPostgresPool()
  await pool.query(`DELETE FROM promos WHERE id = $1`, [id])
  return NextResponse.json({ ok: true })
}
