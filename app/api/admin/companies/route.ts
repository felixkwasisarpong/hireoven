import { NextRequest, NextResponse } from "next/server"
import { assertAdminAccess } from "@/lib/admin/auth"
import { resolveCompanyDomain, resolveCompanyLogoUrl } from "@/lib/companies/domain-normalization"
import { getPostgresPool } from "@/lib/postgres/server"
import type { Company } from "@/types"

const SORT_COLUMNS: Record<string, string> = {
  name: "name ASC",
  domain: "domain ASC",
  ats: "ats_type ASC NULLS LAST",
  status: "is_active DESC",
  last_crawled: "last_crawled_at DESC NULLS LAST",
  job_count: "job_count DESC",
  h1b: "sponsorship_confidence DESC",
}

export async function GET(request: NextRequest) {
  const access = await assertAdminAccess()
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  // Paginated + filtered server-side. The companies table is ~60k rows; loading
  // it whole hung the page (huge payload + tens of thousands of DOM rows).
  const sp = request.nextUrl.searchParams
  const page = Math.max(1, Number.parseInt(sp.get("page") ?? "1", 10) || 1)
  const limit = Math.min(200, Math.max(1, Number.parseInt(sp.get("limit") ?? "50", 10) || 50))
  const offset = (page - 1) * limit
  const q = (sp.get("q") ?? "").trim()
  const ats = (sp.get("ats") ?? "").trim()
  const status = (sp.get("status") ?? "all").trim()
  const orderBy = SORT_COLUMNS[sp.get("sort") ?? "name"] ?? SORT_COLUMNS.name

  const where: string[] = []
  const params: unknown[] = []
  if (q) {
    params.push(`%${q}%`)
    where.push(`(name ILIKE $${params.length} OR domain ILIKE $${params.length})`)
  }
  if (ats) {
    params.push(ats)
    where.push(`ats_type = $${params.length}`)
  }
  if (status === "active") where.push("is_active = true")
  else if (status === "inactive") where.push("is_active = false")
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : ""

  params.push(limit)
  const limitIdx = params.length
  params.push(offset)
  const offsetIdx = params.length

  const pool = getPostgresPool()
  const result = await pool.query<Company & { __total: string }>(
    `SELECT id, name, domain, ats_type, is_active, job_count, last_crawled_at,
            sponsorship_confidence, logo_url, count(*) OVER() AS __total
       FROM companies
       ${whereSql}
      ORDER BY ${orderBy}, id
      LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    params
  )
  const total = result.rows[0] ? Number(result.rows[0].__total) : 0
  const companies = result.rows.map(({ __total: _t, ...company }) => company)
  return NextResponse.json({ companies, total, page, limit })
}

export async function POST(request: NextRequest) {
  const access = await assertAdminAccess()
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const body = (await request.json().catch(() => ({}))) as Partial<Company>
  if (!body.name?.trim()) return NextResponse.json({ error: "name is required" }, { status: 400 })
  const domain = resolveCompanyDomain({
    domain: body.domain ?? null,
    careersUrl: body.careers_url ?? null,
    logoUrl: body.logo_url ?? null,
  })
  const logoUrl = resolveCompanyLogoUrl({ domain, logoUrl: body.logo_url ?? null })

  const pool = getPostgresPool()
  const result = await pool.query<Company>(
    `INSERT INTO companies (name, domain, ats_type, careers_url, logo_url, industry, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [body.name, domain ?? "", body.ats_type ?? null, body.careers_url ?? null, logoUrl, body.industry ?? null, body.is_active ?? true]
  )
  return NextResponse.json({ company: result.rows[0] }, { status: 201 })
}
