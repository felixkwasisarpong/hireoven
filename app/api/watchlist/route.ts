import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres/server"
import type { WatchlistWithCompany } from "@/types"

export const runtime = "nodejs"

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const pool = getPostgresPool()
  const result = await pool.query<WatchlistWithCompany>(
    `SELECT w.*, to_jsonb(c.*) AS company
     FROM watchlist w
     LEFT JOIN companies c ON c.id = w.company_id
     WHERE w.user_id = $1
     ORDER BY w.created_at DESC`,
    [user.id]
  )

  return NextResponse.json({ watchlist: result.rows })
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = (await request.json().catch(() => ({}))) as { companyId?: string }
  if (!body.companyId) {
    return NextResponse.json({ error: "companyId is required" }, { status: 400 })
  }

  const pool = getPostgresPool()

  const companyResult = await pool.query<{ id: string }>(
    `SELECT id FROM companies WHERE id = $1 LIMIT 1`,
    [body.companyId]
  )
  if (companyResult.rows.length === 0) {
    return NextResponse.json({ error: "Company not found" }, { status: 404 })
  }

  const result = await pool.query<WatchlistWithCompany>(
    `INSERT INTO watchlist (user_id, company_id)
     VALUES ($1, $2)
     ON CONFLICT (user_id, company_id) DO NOTHING
     RETURNING *`,
    [user.id, body.companyId]
  )

  return NextResponse.json({ item: result.rows[0] ?? null }, { status: 201 })
}

export async function DELETE(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const companyId = new URL(request.url).searchParams.get("companyId")
  if (!companyId) {
    return NextResponse.json({ error: "companyId is required" }, { status: 400 })
  }

  const pool = getPostgresPool()
  await pool.query(
    `DELETE FROM watchlist WHERE user_id = $1 AND company_id = $2`,
    [user.id, companyId]
  )

  return NextResponse.json({ ok: true })
}
