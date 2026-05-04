import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres/server"

export const dynamic = "force-dynamic"

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const pool = getPostgresPool()
  await pool.query(
    `INSERT INTO public.user_brand_profiles (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
    [user.id]
  )
  const result = await pool.query(
    `SELECT * FROM public.user_brand_profiles WHERE user_id = $1`,
    [user.id]
  )
  return NextResponse.json({ profile: result.rows[0] ?? null })
}

export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const allowed = new Set([
    "linkedin_url", "headline", "has_about_section", "skills_count",
    "recommendations_count", "estimated_connections", "communities_active",
    "last_post_detected_at", "days_since_last_activity", "posting_frequency_target",
  ])

  const entries = Object.entries(body).filter(([k]) => allowed.has(k))
  if (entries.length === 0) return NextResponse.json({ ok: true })

  const pool = getPostgresPool()
  const values: unknown[] = []
  const setSql = entries.map(([k, v], i) => { values.push(v); return `${k} = $${i + 1}` })
  values.push(user.id)

  await pool.query(
    `UPDATE public.user_brand_profiles SET ${setSql.join(", ")}, updated_at = now()
     WHERE user_id = $${values.length}`,
    values
  )
  return NextResponse.json({ ok: true })
}
