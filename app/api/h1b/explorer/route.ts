import { NextRequest, NextResponse } from "next/server"
import { getPostgresPool } from "@/lib/postgres/server"
import type { EmployerLCAStats, LCARecord } from "@/types"

export const runtime = "nodejs"

function likeParam(raw: string | null): string | null {
  if (!raw) return null
  const cleaned = raw.replace(/%/g, "").replace(/_/g, "").trim()
  if (!cleaned) return null
  return `%${cleaned}%`
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams
  const tab = sp.get("tab") === "employers" ? "employers" : "records"
  const page = Math.max(0, parseInt(sp.get("page") ?? "0", 10))
  const pageSize = Math.min(100, Math.max(1, parseInt(sp.get("pageSize") ?? "50", 10)))
  const offset = page * pageSize

  const q = likeParam(sp.get("q"))
  const fiscalYear = sp.get("fiscalYear")?.trim() || null
  const state = sp.get("state")?.trim() || null
  const caseStatus = sp.get("caseStatus")?.trim() || null
  const wageLevel = sp.get("wageLevel")?.trim() || null

  const pool = getPostgresPool()

  try {
    if (tab === "records") {
      const values: unknown[] = []
      const where: string[] = ["1=1"]
      if (q) {
        values.push(q)
        where.push(`(employer_name ILIKE $${values.length} OR job_title ILIKE $${values.length})`)
      }
      if (fiscalYear) {
        values.push(Number.parseInt(fiscalYear, 10))
        where.push(`fiscal_year = $${values.length}`)
      }
      if (state) {
        values.push(state)
        where.push(`worksite_state_abbr = $${values.length}`)
      }
      if (caseStatus) {
        values.push(caseStatus)
        where.push(`case_status = $${values.length}`)
      }
      if (wageLevel) {
        values.push(wageLevel)
        where.push(`wage_level = $${values.length}`)
      }
      const limitParam = values.length + 1
      const offsetParam = values.length + 2
      values.push(pageSize, offset)
      const sql = `
        SELECT *, COUNT(*) OVER()::text AS _total
        FROM lca_records
        WHERE ${where.join(" AND ")}
        ORDER BY decision_date DESC NULLS LAST
        LIMIT $${limitParam} OFFSET $${offsetParam}`
      const result = await pool.query<LCARecord & { _total: string }>(sql, values)
      const total = result.rows[0] ? Number.parseInt(result.rows[0]._total, 10) : 0
      const rows = result.rows.map(({ _total: _t, ...rest }) => rest) as LCARecord[]
      return NextResponse.json({ tab, records: rows, count: total })
    }

    const values: unknown[] = []
    const where: string[] = ["1=1"]
    if (q) {
      values.push(q)
      where.push(
        `(display_name ILIKE $${values.length} OR employer_name_normalized ILIKE $${values.length})`
      )
    }
    const limitParam = values.length + 1
    const offsetParam = values.length + 2
    values.push(pageSize, offset)
    const sql = `
      SELECT *, COUNT(*) OVER()::text AS _total
      FROM employer_lca_stats
      WHERE ${where.join(" AND ")}
      ORDER BY total_applications DESC
      LIMIT $${limitParam} OFFSET $${offsetParam}`
    const result = await pool.query<EmployerLCAStats & { _total: string }>(sql, values)
    const total = result.rows[0] ? Number.parseInt(result.rows[0]._total, 10) : 0
    const rows = result.rows.map(({ _total: _t, ...rest }) => rest) as EmployerLCAStats[]
    return NextResponse.json({ tab, employers: rows, count: total })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Query failed" },
      { status: 500 }
    )
  }
}
