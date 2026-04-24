import { NextRequest, NextResponse } from "next/server"
import { assertAdminAccess } from "@/lib/admin/auth"
import { getPostgresPool } from "@/lib/postgres/server"

export async function GET(request: NextRequest) {
  const access = await assertAdminAccess()
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const sp = request.nextUrl.searchParams
  const mode = sp.get("mode") ?? "records"
  const pool = getPostgresPool()

  if (mode === "unmatched") {
    const minPetitions = Math.max(1, parseInt(sp.get("minPetitions") ?? "25", 10))
    const search = sp.get("q")?.trim() ?? ""
    const pageSize = Math.min(100, parseInt(sp.get("limit") ?? "25", 10))

    const searchClause = search ? `AND employer_name ILIKE $3` : ""
    const baseParams: unknown[] = [null, minPetitions]
    if (search) baseParams.push(`%${search}%`)

    const [grandTotal, totalUnmatched, atThreshold, page] = await Promise.all([
      pool.query<{ c: string }>(`SELECT COUNT(*)::text AS c FROM h1b_records`),
      pool.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM h1b_records WHERE company_id IS NULL`
      ),
      pool.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM h1b_records WHERE company_id IS $1 AND total_petitions >= $2 ${searchClause}`,
        baseParams
      ),
      pool.query(
        `SELECT h.*, to_jsonb(c.*) AS company
         FROM h1b_records h
         LEFT JOIN companies c ON c.id = h.company_id
         WHERE h.company_id IS $1
           AND h.total_petitions >= $2
           ${searchClause}
         ORDER BY h.total_petitions DESC
         LIMIT ${pageSize}`,
        baseParams
      ),
    ])

    return NextResponse.json({
      grandTotal: Number(grandTotal.rows[0]?.c ?? 0),
      unmatchedTotal: Number(totalUnmatched.rows[0]?.c ?? 0),
      atThresholdCount: Number(atThreshold.rows[0]?.c ?? 0),
      records: page.rows,
    })
  }

  // Default: recent records with company join
  const result = await pool.query(
    `SELECT h.*, to_jsonb(c.*) AS company
     FROM h1b_records h
     LEFT JOIN companies c ON c.id = h.company_id
     ORDER BY h.year DESC, h.total_petitions DESC
     LIMIT 2000`
  )
  return NextResponse.json({ records: result.rows })
}

export async function POST(request: NextRequest) {
  const access = await assertAdminAccess()
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const body = (await request.json().catch(() => ({}))) as {
    recordId?: string
    companyId?: string
    sponsorCount?: number
    sponsorsH1b?: boolean
    sponsorshipConfidence?: number
  }
  if (!body.recordId || !body.companyId) {
    return NextResponse.json({ error: "recordId and companyId are required" }, { status: 400 })
  }

  const pool = getPostgresPool()
  await Promise.all([
    pool.query(`UPDATE h1b_records SET company_id = $1 WHERE id = $2`, [body.companyId, body.recordId]),
    pool.query(
      `UPDATE companies
       SET h1b_sponsor_count_1yr = $1,
           sponsors_h1b = $2,
           sponsorship_confidence = $3
       WHERE id = $4`,
      [body.sponsorCount ?? 0, body.sponsorsH1b ?? false, body.sponsorshipConfidence ?? 0, body.companyId]
    ),
  ])

  return NextResponse.json({ ok: true })
}
