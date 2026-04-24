import { NextRequest, NextResponse } from "next/server"
import { getPostgresPool } from "@/lib/postgres/server"
import type { H1BRecord } from "@/types"

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams
  const companyId = sp.get("companyId")
  const limit = Math.min(100, parseInt(sp.get("limit") ?? "10", 10))

  if (!companyId) {
    return NextResponse.json({ error: "companyId is required" }, { status: 400 })
  }

  const pool = getPostgresPool()
  const result = await pool.query<H1BRecord>(
    `SELECT *
     FROM h1b_records
     WHERE company_id = $1
     ORDER BY year DESC
     LIMIT $2`,
    [companyId, limit]
  )

  return NextResponse.json({ records: result.rows })
}
