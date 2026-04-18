import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export const runtime = "nodejs"

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const jobId = request.nextUrl.searchParams.get("jobId")

  if (jobId) {
    const { data, error } = await (supabase as any)
      .from("job_applications")
      .select("id, status, applied_at")
      .eq("user_id", user.id)
      .eq("job_id", jobId)
      .in("status", ["applied", "phone_screen", "interview", "offer"])
      .order("applied_at", { ascending: false })
      .limit(1)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      hasApplied: Boolean(data?.length),
      application: data?.[0] ?? null,
    })
  }

  const { data, error } = await (supabase as any)
    .from("job_applications")
    .select("*")
    .eq("user_id", user.id)
    .order("applied_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(200)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ applications: data ?? [] })
}
