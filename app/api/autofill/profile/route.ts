import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import type { AutofillProfile, AutofillProfileInsert, AutofillProfileUpdate } from "@/types"

export const runtime = "nodejs"

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

  const { data } = await (supabase
    .from("autofill_profiles" as any)
    .select("*")
    .eq("user_id", user.id)
    .single() as any)

  const profile = data as AutofillProfile | null
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

  const { data, error } = await (supabase
    .from("autofill_profiles" as any)
    .upsert(
      { ...body, user_id: user.id, updated_at: new Date().toISOString() } as any,
      { onConflict: "user_id" }
    )
    .select("*")
    .single() as any)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const profile = data as AutofillProfile
  const completion = calcCompletion(profile)
  return NextResponse.json({ profile, completion, completionPct: completion })
}

export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json().catch(() => ({})) as AutofillProfileUpdate
  const table = (supabase as any).from("autofill_profiles")

  const { data, error } = await table
    .update({ ...body, updated_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .select("*")
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const profile = data as AutofillProfile
  const completion = calcCompletion(profile)
  return NextResponse.json({ profile, completion, completionPct: completion })
}
