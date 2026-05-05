import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres/server"

export const runtime = "nodejs"

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const pool = getPostgresPool()
  const result = await pool.query<{ default_feed_filters: string | null }>(
    `SELECT default_feed_filters FROM profiles WHERE id = $1 LIMIT 1`,
    [user.id]
  )
  return NextResponse.json({ default: result.rows[0]?.default_feed_filters ?? null })
}

export async function PUT(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = (await request.json().catch(() => ({}))) as { params?: string }
  const raw = typeof body.params === "string" ? body.params.trim() : ""
  if (raw.length === 0) {
    return NextResponse.json({ error: "Empty filter string" }, { status: 400 })
  }
  if (raw.length > 2000) {
    return NextResponse.json({ error: "Filter string too long" }, { status: 400 })
  }

  const normalized = new URLSearchParams(raw.replace(/^\?/, "")).toString()

  const pool = getPostgresPool()
  await pool.query(
    `UPDATE profiles SET default_feed_filters = $1, updated_at = now() WHERE id = $2`,
    [normalized, user.id]
  )
  return NextResponse.json({ default: normalized })
}

export async function DELETE() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const pool = getPostgresPool()
  await pool.query(
    `UPDATE profiles SET default_feed_filters = NULL, updated_at = now() WHERE id = $1`,
    [user.id]
  )
  return NextResponse.json({ default: null })
}
