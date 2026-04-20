import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = (await request.json().catch(() => ({}))) as {
    reason?: string
    details?: string
  }

  const admin = createAdminClient()
  const { data: latest } = await (admin as any)
    .from("subscriptions")
    .select("id")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!latest?.id) {
    return NextResponse.json({ error: "Subscription not found" }, { status: 404 })
  }

  const { error } = await (admin as any)
    .from("subscriptions")
    .update({
      cancellation_feedback: {
        reason: body.reason ?? null,
        details: body.details ?? null,
        submitted_at: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", latest.id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
