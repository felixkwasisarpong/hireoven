import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres/server"
import type { Profile, ProfileUpdate } from "@/types"

export const runtime = "nodejs"

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const pool = getPostgresPool()
  const result = await pool.query<Profile>(
    `SELECT * FROM profiles WHERE id = $1 LIMIT 1`,
    [user.id]
  )

  return NextResponse.json({ profile: result.rows[0] ?? null })
}

export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = (await request.json().catch(() => ({}))) as ProfileUpdate

  const allowed: Array<keyof ProfileUpdate> = [
    "full_name", "avatar_url", "desired_roles", "desired_locations",
    "desired_seniority", "desired_employment_types", "seniority_level",
    "top_skills", "remote_only", "is_international", "visa_status",
    "opt_end_date", "needs_sponsorship", "alert_frequency",
    "email_alerts", "push_alerts", "email",
  ]

  const fields = Object.keys(body).filter((k) => allowed.includes(k as keyof ProfileUpdate))
  if (fields.length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 })
  }

  const arrayFields = new Set(["desired_roles", "desired_locations", "desired_seniority", "desired_employment_types", "top_skills"])
  const values: unknown[] = []
  const setClauses = fields.map((k) => {
    values.push((body as Record<string, unknown>)[k])
    return arrayFields.has(k) ? `${k} = $${values.length}::text[]` : `${k} = $${values.length}`
  })
  values.push(user.id)

  const pool = getPostgresPool()
  const result = await pool.query<Profile>(
    `UPDATE profiles
     SET ${setClauses.join(", ")}, updated_at = now()
     WHERE id = $${values.length}
     RETURNING *`,
    values
  )

  if (result.rows.length === 0) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 })
  }

  return NextResponse.json({ profile: result.rows[0] })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = (await request.json().catch(() => ({}))) as Partial<Profile>

  const pool = getPostgresPool()
  const result = await pool.query<Profile>(
    `INSERT INTO profiles (id, email, full_name, avatar_url)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE
       SET email = EXCLUDED.email,
           full_name = COALESCE(EXCLUDED.full_name, profiles.full_name),
           avatar_url = COALESCE(EXCLUDED.avatar_url, profiles.avatar_url),
           updated_at = now()
     RETURNING *`,
    [
      user.id,
      body.email ?? user.email ?? null,
      body.full_name ?? (user.user_metadata?.full_name as string | null) ?? null,
      body.avatar_url ?? (user.user_metadata?.avatar_url as string | null) ?? null,
    ]
  )

  return NextResponse.json({ profile: result.rows[0] })
}
