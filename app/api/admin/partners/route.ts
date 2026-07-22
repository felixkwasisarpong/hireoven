import { NextResponse } from "next/server"
import { assertAdminAccess } from "@/lib/admin/auth"
import { getPostgresPool } from "@/lib/postgres/server"
import { listAllPartners, type PartnerRow } from "@/lib/marketing/social-proof-store"

export const runtime = "nodejs"

export async function GET() {
  const access = await assertAdminAccess()
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  const partners = await listAllPartners()
  return NextResponse.json({ partners })
}

export async function POST(request: Request) {
  const access = await assertAdminAccess()
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  let body: Partial<PartnerRow>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Could not parse request body" }, { status: 400 })
  }

  if (!body.name?.toString().trim()) {
    return NextResponse.json({ error: "Missing required field: name" }, { status: 400 })
  }

  const pool = getPostgresPool()
  const result = await pool.query<PartnerRow>(
    `INSERT INTO partners (name, logo_url, url, is_published, sort_order)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING *`,
    [
      body.name.trim(),
      body.logo_url?.toString().trim() || null,
      body.url?.toString().trim() || null,
      body.is_published ?? false,
      Number.isFinite(body.sort_order) ? body.sort_order : 0,
    ],
  )
  return NextResponse.json({ partner: result.rows[0] }, { status: 201 })
}
