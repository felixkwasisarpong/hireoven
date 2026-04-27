import { NextRequest, NextResponse } from "next/server"
import { assertAdminAccess } from "@/lib/admin/auth"
import { resolveCompanyDomain, resolveCompanyLogoUrl } from "@/lib/companies/domain-normalization"
import { getPostgresPool } from "@/lib/postgres/server"

type CompanyBackfillRow = {
  id: string
  domain: string | null
  careers_url: string | null
  logo_url: string | null
}

export async function POST(request: NextRequest) {
  const access = await assertAdminAccess()
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const body = (await request.json().catch(() => ({}))) as {
    limit?: number
    dryRun?: boolean
  }
  const limit = Math.min(2000, Math.max(1, Number(body.limit ?? 500)))
  const dryRun = Boolean(body.dryRun)
  const pool = getPostgresPool()

  const { rows } = await pool.query<CompanyBackfillRow>(
    `SELECT id, domain, careers_url, logo_url
     FROM companies
     ORDER BY updated_at DESC
     LIMIT $1`,
    [limit]
  )

  let updated = 0
  let domainUpdated = 0
  let logoUpdated = 0

  for (const row of rows) {
    const nextDomain = resolveCompanyDomain({
      domain: row.domain,
      careersUrl: row.careers_url,
      logoUrl: row.logo_url,
    })
    const nextLogoUrl = resolveCompanyLogoUrl({
      domain: nextDomain,
      logoUrl: row.logo_url,
    })

    const domainChanged = (nextDomain ?? null) !== (row.domain ?? null)
    const logoChanged = (nextLogoUrl ?? null) !== (row.logo_url ?? null)
    if (!domainChanged && !logoChanged) continue

    updated += 1
    if (domainChanged) domainUpdated += 1
    if (logoChanged) logoUpdated += 1
    if (dryRun) continue

    await pool.query(
      `UPDATE companies
       SET domain = $1,
           logo_url = $2,
           updated_at = now()
       WHERE id = $3`,
      [nextDomain ?? "", nextLogoUrl, row.id]
    )
  }

  return NextResponse.json({
    ok: true,
    checked: rows.length,
    updated,
    domainUpdated,
    logoUpdated,
    dryRun,
  })
}
