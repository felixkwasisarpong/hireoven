import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export const runtime = "nodejs"

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { data, error } = await (supabase as any)
    .from("autofill_history")
    .select("*")
    .eq("user_id", user.id)
    .order("applied_at", { ascending: false })
    .limit(100)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const history = data ?? []
  const totalApplications = history.length
  const avgFillRate =
    totalApplications > 0
      ? Math.round(
          history.reduce((acc: number, h: any) => acc + (h.fill_rate ?? 0), 0) /
            totalApplications
        )
      : 0

  // Rough time saved: ~12 min per application on average
  const minutesSaved = totalApplications * 12

  return NextResponse.json({ history, totalApplications, avgFillRate, minutesSaved })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json().catch(() => ({})) as {
    job_id?: string
    resume_id?: string
    company_name?: string
    job_title?: string
    apply_url?: string
    ats_type?: string
    fields_filled?: number
    fields_total?: number
  }

  const { fields_filled = 0, fields_total = 1 } = body
  const fill_rate = fields_total > 0 ? Math.round((fields_filled / fields_total) * 100) : 0

  const now = new Date().toISOString()

  if (body.job_id) {
    const timeline = [{ status: "applied", date: now, note: "Logged via Hireoven autofill" }]

    const { data: existingApplication } = await (supabase as any)
      .from("job_applications")
      .select("id")
      .eq("user_id", user.id)
      .eq("job_id", body.job_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (existingApplication?.id) {
      const { error: applicationError } = await (supabase as any)
        .from("job_applications")
        .update({
          resume_id: body.resume_id ?? null,
          status: "applied",
          company_name: body.company_name ?? "Unknown company",
          job_title: body.job_title ?? "Untitled role",
          apply_url: body.apply_url ?? null,
          applied_at: now,
          timeline,
        })
        .eq("id", existingApplication.id)

      if (applicationError) {
        return NextResponse.json({ error: applicationError.message }, { status: 500 })
      }
    } else {
      const { error: applicationError } = await (supabase as any)
        .from("job_applications")
        .insert({
          user_id: user.id,
          job_id: body.job_id,
          resume_id: body.resume_id ?? null,
          status: "applied",
          company_name: body.company_name ?? "Unknown company",
          job_title: body.job_title ?? "Untitled role",
          apply_url: body.apply_url ?? null,
          applied_at: now,
          timeline,
        })

      if (applicationError) {
        return NextResponse.json({ error: applicationError.message }, { status: 500 })
      }
    }
  }

  const { data, error } = await (supabase as any)
    .from("autofill_history")
    .insert({
      user_id: user.id,
      job_id: body.job_id ?? null,
      company_name: body.company_name ?? null,
      job_title: body.job_title ?? null,
      ats_type: body.ats_type ?? null,
      fields_filled,
      fields_total,
      fill_rate,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ entry: data }, { status: 201 })
}
