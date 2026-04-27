import { NextRequest, NextResponse } from "next/server"
import { assertAdminAccess } from "@/lib/admin/auth"
import { resolveCompanyDomain, resolveCompanyLogoUrl } from "@/lib/companies/domain-normalization"
import { getPostgresPool } from "@/lib/postgres/server"

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const access = await assertAdminAccess()
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const { id } = await params
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const pool = getPostgresPool()

  const allowed = ["name", "domain", "ats_type", "careers_url", "logo_url", "industry",
    "is_active", "size", "sponsors_h1b", "sponsorship_confidence", "raw_ats_config",
    "job_count", "description"]
  if ("domain" in body || "careers_url" in body || "logo_url" in body) {
    const currentResult = await pool.query<{
      domain: string | null
      careers_url: string | null
      logo_url: string | null
    }>(
      `SELECT domain, careers_url, logo_url FROM companies WHERE id = $1 LIMIT 1`,
      [id]
    )
    const current = currentResult.rows[0]
    if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const domain = resolveCompanyDomain({
      domain: (body.domain as string | null | undefined) ?? current.domain,
      careersUrl: (body.careers_url as string | null | undefined) ?? current.careers_url,
      logoUrl: (body.logo_url as string | null | undefined) ?? current.logo_url,
    })
    body.domain = domain
    body.logo_url = resolveCompanyLogoUrl({
      domain,
      logoUrl: (body.logo_url as string | null | undefined) ?? current.logo_url,
    })
  }
  const fields = Object.keys(body).filter((k) => allowed.includes(k))
  if (fields.length === 0) return NextResponse.json({ error: "No valid fields" }, { status: 400 })

  const values: unknown[] = []
  const setClauses = fields.map((k) => {
    values.push(k === "raw_ats_config" ? JSON.stringify(body[k]) : body[k])
    return k === "raw_ats_config" ? `${k} = $${values.length}::jsonb` : `${k} = $${values.length}`
  })
  values.push(id)

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
