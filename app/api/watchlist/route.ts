import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres/server"
import type { WatchlistWithCompany } from "@/types"
import { listWatchlistWithCompany } from "@/lib/watchlist/store"
import { getPlanForUserId } from "@/lib/gates/server-gate"
import { SOFT_LIMITS } from "@/lib/gates/index"

export const runtime = "nodejs"

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const pool = getPostgresPool()
  const { rows } = await listWatchlistWithCompany({ db: pool, userId: user.id })
  return NextResponse.json(
    { watchlist: rows },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  )
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

  const plan = await getPlanForUserId(user.id)
  if (plan === "free") {
    const countResult = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM watchlist WHERE user_id = $1`,
      [user.id]
    )
    const current = parseInt(countResult.rows[0]?.count ?? "0", 10)
    const limit = SOFT_LIMITS.watchlist ?? 5
    if (current >= limit) {
      return NextResponse.json(
        { error: `Free plan is limited to ${limit} watched companies. Upgrade to Pro for unlimited.`, code: "QUOTA_EXCEEDED", limit },
        { status: 429 }
      )
    }
  }

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
