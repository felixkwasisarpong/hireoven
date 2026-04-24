import { NextRequest, NextResponse } from "next/server"
import { assertAdminAccess } from "@/lib/admin/auth"
import { getPostgresPool } from "@/lib/postgres/server"
import type { Company } from "@/types"

export async function GET() {
  const access = await assertAdminAccess()
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const pool = getPostgresPool()
  const result = await pool.query<Company>(`SELECT * FROM companies ORDER BY name`)
  return NextResponse.json({ companies: result.rows })
}

export async function POST(request: NextRequest) {
  const access = await assertAdminAccess()
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const body = (await request.json().catch(() => ({}))) as Partial<Company>
  if (!body.name?.trim()) return NextResponse.json({ error: "name is required" }, { status: 400 })

  const pool = getPostgresPool()
  const result = await pool.query<Company>(
    `INSERT INTO companies (name, domain, ats_type, careers_url, logo_url, industry, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [body.name, body.domain ?? "", body.ats_type ?? null, body.careers_url ?? null, body.logo_url ?? null, body.industry ?? null, body.is_active ?? true]
  )
  return NextResponse.json({ company: result.rows[0] }, { status: 201 })
}
