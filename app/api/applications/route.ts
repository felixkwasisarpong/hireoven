import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { randomUUID } from "crypto"

export const runtime = "nodejs"

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const url = request.nextUrl
  const jobId = url.searchParams.get("jobId")
  const status = url.searchParams.get("status")
  const search = url.searchParams.get("search")
  const sort = url.searchParams.get("sort") ?? "updated_at"

  if (jobId) {
    const { data } = await (supabase as any)
      .from("job_applications")
      .select("id, status, applied_at")
      .eq("user_id", user.id)
      .eq("job_id", jobId)
      .eq("is_archived", false)
      .order("applied_at", { ascending: false })
      .limit(1)

    return NextResponse.json({
      hasApplied: Boolean(data?.length),
      application: data?.[0] ?? null,
    })
  }

  let query = (supabase as any)
    .from("job_applications")
    .select("*")
    .eq("user_id", user.id)
    .eq("is_archived", false)

  if (status) query = query.eq("status", status)
  if (search) {
    query = query.or(
      `company_name.ilike.%${search}%,job_title.ilike.%${search}%`
    )
  }

  const sortCol = ["applied_at", "created_at", "updated_at", "match_score", "company_name"].includes(sort)
    ? sort : "updated_at"
  query = query.order(sortCol, { ascending: sortCol === "company_name" })

  const { data, error } = await query.limit(500)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ applications: data ?? [] })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json().catch(() => ({})) as {
    jobId?: string
    companyName?: string
    companyLogoUrl?: string
    jobTitle?: string
    applyUrl?: string
    status?: string
    resumeId?: string
    matchScore?: number
    notes?: string
    appliedAt?: string
    source?: string
  }

  if (!body.companyName?.trim() || !body.jobTitle?.trim()) {
    return NextResponse.json({ error: "companyName and jobTitle are required" }, { status: 400 })
  }

  const now = new Date().toISOString()
  const status = body.status ?? "saved"

  const initialEntry = {
    id: randomUUID(),
    type: "status_change",
    status,
    date: now,
    auto: true,
    note: status === "applied" ? "Application submitted" : `Added to ${status}`,
  }

  const { data, error } = await (supabase as any)
    .from("job_applications")
    .insert({
      user_id: user.id,
      job_id: body.jobId ?? null,
      resume_id: body.resumeId ?? null,
      status,
      company_name: body.companyName,
      company_logo_url: body.companyLogoUrl ?? null,
      job_title: body.jobTitle,
      apply_url: body.applyUrl ?? null,
      applied_at: status === "applied" ? (body.appliedAt ?? now) : null,
      match_score: body.matchScore ?? null,
      notes: body.notes ?? null,
      timeline: [initialEntry],
      interviews: [],
      is_archived: false,
      source: body.source ?? "manual",
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ application: data }, { status: 201 })
}
