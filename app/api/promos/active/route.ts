import { NextResponse } from "next/server"
import { getPostgresPool } from "@/lib/postgres/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export type ActivePromo = {
  id: string
  title: string
  subtitle: string
  description: string
  badge_label: string
  is_new: boolean
  theme: string
  icon: string
  cta_label: string
  cta_url: string
  ends_at: string | null
}

export async function GET() {
  const pool = getPostgresPool()
  const now = new Date().toISOString()

  const result = await pool.query<ActivePromo>(
    `SELECT id, title, subtitle, description, badge_label, is_new, theme, icon, cta_label, cta_url, ends_at
     FROM promos
     WHERE is_active = true
       AND (starts_at IS NULL OR starts_at <= $1::timestamptz)
       AND (ends_at   IS NULL OR ends_at   >  $1::timestamptz)
     ORDER BY updated_at DESC
     LIMIT 1`,
    [now]
  )

  return NextResponse.json({ promo: result.rows[0] ?? null })
}
