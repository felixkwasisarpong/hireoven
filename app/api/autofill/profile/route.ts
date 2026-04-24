import { NextResponse } from "next/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { createClient } from "@/lib/supabase/server"
import type { AutofillProfile, AutofillProfileInsert, AutofillProfileUpdate } from "@/types"

export const runtime = "nodejs"

async function getExistingProfile(userId: string) {
  const pool = getPostgresPool()
  const result = await pool.query<AutofillProfile>(
    `SELECT *
     FROM autofill_profiles
     WHERE user_id = $1
     ORDER BY updated_at DESC
     LIMIT 1`,
    [userId]
  )

  return result.rows[0] ?? null
}

function calcCompletion(p: Partial<AutofillProfile>): number {
  const required: Array<keyof AutofillProfile> = [
    "first_name", "last_name", "email", "phone",
    "linkedin_url", "work_authorization", "years_of_experience",
    "salary_expectation_min", "highest_degree", "university",
  ]
  const optional: Array<keyof AutofillProfile> = [
    "github_url", "portfolio_url", "city", "state",
    "earliest_start_date", "gpa",
  ]

  const reqFilled = required.filter((k) => {
    const v = p[k]
    return v !== null && v !== undefined && v !== ""
  }).length

  const optFilled = optional.filter((k) => {
    const v = p[k]
    return v !== null && v !== undefined && v !== ""
  }).length

  const customBonus = Array.isArray(p.custom_answers) && p.custom_answers.length > 0 ? 5 : 0
  const maxScore = required.length * 10 + optional.length * 5 + 5
  const score = reqFilled * 10 + optFilled * 5 + customBonus
  return Math.round((score / maxScore) * 100)
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const profile = await getExistingProfile(user.id)
  const completion = profile ? calcCompletion(profile) : 0
  return NextResponse.json({
    profile: profile ?? null,
    completion,
    completionPct: completion,
  })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json().catch(() => ({})) as Omit<AutofillProfileInsert, "user_id">

  const pool = getPostgresPool()
  const existing = await getExistingProfile(user.id)

  const payload = {
    ...body,
    user_id: user.id,
    updated_at: new Date().toISOString(),
  } as any

  let profile: AutofillProfile | null = null
  if (existing) {
    const entries = Object.entries(payload)
    const values: unknown[] = []
    const setSql = entries.map(([key, value], idx) => {
      values.push(value)
      return `${key} = $${idx + 1}`
    })
    values.push(existing.id)
    const result = await pool.query<AutofillProfile>(
      `UPDATE autofill_profiles
       SET ${setSql.join(", ")}
       WHERE id = $${values.length}
       RETURNING *`,
      values
    )
    profile = result.rows[0] ?? null
  } else {
    const columns = Object.keys(payload)
    const values = Object.values(payload)
    const placeholders = values.map((_, i) => `$${i + 1}`).join(", ")
    const result = await pool.query<AutofillProfile>(
      `INSERT INTO autofill_profiles (${columns.join(", ")})
       VALUES (${placeholders})
       RETURNING *`,
      values
    )
    profile = result.rows[0] ?? null
  }
  if (!profile) return NextResponse.json({ error: "Failed to save profile" }, { status: 500 })
  const completion = calcCompletion(profile)
  return NextResponse.json({ profile, completion, completionPct: completion })
}

export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json().catch(() => ({})) as AutofillProfileUpdate
  const pool = getPostgresPool()
  const existing = await getExistingProfile(user.id)

  const payload = {
    ...body,
    user_id: user.id,
    updated_at: new Date().toISOString(),
  } as any

  let profile: AutofillProfile | null = null
  if (existing) {
    const entries = Object.entries(payload)
    const values: unknown[] = []
    const setSql = entries.map(([key, value], idx) => {
      values.push(value)
      return `${key} = $${idx + 1}`
    })
    values.push(existing.id)
    const result = await pool.query<AutofillProfile>(
      `UPDATE autofill_profiles
       SET ${setSql.join(", ")}
       WHERE id = $${values.length}
       RETURNING *`,
      values
    )
    profile = result.rows[0] ?? null
  } else {
    const columns = Object.keys(payload)
    const values = Object.values(payload)
    const placeholders = values.map((_, i) => `$${i + 1}`).join(", ")
    const result = await pool.query<AutofillProfile>(
      `INSERT INTO autofill_profiles (${columns.join(", ")})
       VALUES (${placeholders})
       RETURNING *`,
      values
    )
    profile = result.rows[0] ?? null
  }
  if (!profile) return NextResponse.json({ error: "Failed to save profile" }, { status: 500 })
  const completion = calcCompletion(profile)
  return NextResponse.json({ profile, completion, completionPct: completion })
}
