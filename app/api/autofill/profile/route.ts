import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import type { AutofillProfile, AutofillProfileInsert, AutofillProfileUpdate } from "@/types"

export const runtime = "nodejs"

async function getExistingProfile(supabase: any, userId: string) {
  const { data, error } = await (supabase
    .from("autofill_profiles" as any)
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(1) as any)

  if (error) return { profile: null as AutofillProfile | null, error }

  return {
    profile: ((data as AutofillProfile[] | null) ?? [])[0] ?? null,
    error: null,
  }
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

  const { profile, error } = await getExistingProfile(supabase, user.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
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

  const existing = await getExistingProfile(supabase, user.id)
  if (existing.error) return NextResponse.json({ error: existing.error.message }, { status: 500 })

  const payload = {
    ...body,
    user_id: user.id,
    updated_at: new Date().toISOString(),
  } as any

  const table = (supabase as any).from("autofill_profiles")
  const query = existing.profile
    ? (table
        .update(payload)
        .eq("id", existing.profile.id))
    : (table
        .insert(payload))

  const { data, error } = await (query.select("*").single() as any)

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
  const existing = await getExistingProfile(supabase, user.id)
  if (existing.error) return NextResponse.json({ error: existing.error.message }, { status: 500 })

  const payload = {
    ...body,
    user_id: user.id,
    updated_at: new Date().toISOString(),
  } as any

  const table = (supabase as any).from("autofill_profiles")
  const query = existing.profile
    ? (table
        .update(payload)
        .eq("id", existing.profile.id))
    : (table
        .insert(payload))

  const { data, error } = await (query.select("*").single() as any)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const profile = data as AutofillProfile
  const completion = calcCompletion(profile)
  return NextResponse.json({ profile, completion, completionPct: completion })
}
