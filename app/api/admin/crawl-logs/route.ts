import { NextRequest, NextResponse } from "next/server"
import { assertAdminAccess } from "@/lib/admin/auth"
import { getPostgresPool } from "@/lib/postgres/server"

export async function GET() {
  const access = await assertAdminAccess()
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const pool = getPostgresPool()
  const result = await pool.query(
    `SELECT cl.*, to_jsonb(c.*) AS company
     FROM crawl_logs cl
     LEFT JOIN companies c ON c.id = cl.company_id
     ORDER BY cl.crawled_at DESC
     LIMIT 500`
  )
  return NextResponse.json({ crawlLogs: result.rows })
}

export async function DELETE(request: NextRequest) {
  const access = await assertAdminAccess()
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const cutoff = new URL(request.url).searchParams.get("before")
  if (!cutoff) return NextResponse.json({ error: "before date is required" }, { status: 400 })

  const pool = getPostgresPool()
  const result = await pool.query(
    `DELETE FROM crawl_logs WHERE crawled_at < $1 RETURNING id`,
    [cutoff]
  )
  return NextResponse.json({ deleted: result.rowCount })
}
