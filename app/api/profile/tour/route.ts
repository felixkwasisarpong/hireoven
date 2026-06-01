import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres/server"

export const runtime = "nodejs"

type TourRow = {
  product_tour_seen_at: string | null
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const pool = getPostgresPool()
  const result = await pool.query<TourRow>(
    `SELECT product_tour_seen_at
       FROM profiles
      WHERE id = $1
      LIMIT 1`,
    [user.id]
  )

  return NextResponse.json({ seenAt: result.rows[0]?.product_tour_seen_at ?? null })
}

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const seenAt = new Date().toISOString()
  const pool = getPostgresPool()
  const result = await pool.query<TourRow>(
    `INSERT INTO profiles (id, email, product_tour_seen_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (id) DO UPDATE
       SET product_tour_seen_at = EXCLUDED.product_tour_seen_at,
           updated_at = now()
     RETURNING product_tour_seen_at`,
    [user.id, user.email ?? null, seenAt]
  )

  return NextResponse.json({ seenAt: result.rows[0]?.product_tour_seen_at ?? seenAt })
}
