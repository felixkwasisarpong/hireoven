import { NextResponse } from "next/server"
import { getPostgresPool } from "@/lib/postgres/server"

export const dynamic = "force-dynamic"

const PAGE_SIZE = 20

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const stateCode = searchParams.get("stateCode")?.toUpperCase() ?? null
  const industry = searchParams.get("industry") ?? null
  const companyName = searchParams.get("companyName") ?? null
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10))
  const offset = (page - 1) * PAGE_SIZE

  const pool = getPostgresPool()

  const conditions: string[] = []
  const params: unknown[] = []
  let paramIdx = 1

  if (companyName) {
    conditions.push(`fce.company_name ILIKE $${paramIdx}`)
    params.push(`%${companyName}%`)
    paramIdx++
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""

  try {
    const [rowsResult, countResult] = await Promise.all([
      pool.query<{
        id: string
        company_id: string | null
        company_name: string
        pledge_type: string
        pledge_source_url: string | null
        verified: boolean
        verified_at: string | null
        created_at: string
        matched_company_domain: string | null
      }>(
        `SELECT
          fce.id,
          fce.company_id,
          fce.company_name,
          fce.pledge_type,
          fce.pledge_source_url,
          fce.verified,
          fce.verified_at,
          fce.created_at,
          c.domain AS matched_company_domain
        FROM public.fair_chance_employers fce
        LEFT JOIN public.companies c ON c.id = fce.company_id
        ${whereClause}
        ORDER BY fce.verified DESC, fce.company_name ASC
        LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
        [...params, PAGE_SIZE, offset]
      ),
      pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM public.fair_chance_employers fce ${whereClause}`,
        params
      ),
    ])

    const total = parseInt(countResult.rows[0]?.count ?? "0", 10)

    return NextResponse.json({
      employers: rowsResult.rows,
      pagination: {
        page,
        pageSize: PAGE_SIZE,
        total,
        totalPages: Math.ceil(total / PAGE_SIZE),
      },
    })
  } catch (err) {
    console.error("[background-check/fair-chance-employers] Query error:", err instanceof Error ? err.message : err)
    return NextResponse.json({ error: "Failed to fetch fair chance employers" }, { status: 500 })
  }
}
