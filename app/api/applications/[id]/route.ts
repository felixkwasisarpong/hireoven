import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { enrichJobApplicationsWithDomain } from "@/lib/applications/enrich-applications"
import { randomUUID } from "crypto"

export const runtime = "nodejs"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { data, error } = await (supabase as any)
    .from("job_applications")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .single()

  if (error) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const [enriched] = await enrichJobApplicationsWithDomain(supabase, [data as Record<string, unknown>])
  return NextResponse.json({ application: enriched })
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json().catch(() => ({})) as Record<string, unknown>

  // Fetch current application to build timeline entry
  const { data: current } = await (supabase as any)
    .from("job_applications")
    .select("status, timeline, applied_at")
    .eq("id", id)
    .eq("user_id", user.id)
    .single()

  if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const updates: Record<string, unknown> = { ...body, updated_at: new Date().toISOString() }

  // Auto-create timeline entry on status change
  if (body.status && body.status !== current.status) {
    const newEntry = {
      id: randomUUID(),
      type: "status_change",
      status: body.status,
      date: new Date().toISOString(),
      auto: true,
      note: null,
    }
    updates.timeline = [...((current.timeline as unknown[]) ?? []), newEntry]

    // Auto-set applied_at when moved to applied
    if (body.status === "applied" && !current.applied_at) {
      updates.applied_at = new Date().toISOString()
    }
  }

  const { data, error } = await (supabase as any)
    .from("job_applications")
    .update(updates)
    .eq("id", id)
    .eq("user_id", user.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const [enriched] = await enrichJobApplicationsWithDomain(supabase, [data as Record<string, unknown>])
  return NextResponse.json({ application: enriched })
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { error } = await (supabase as any)
    .from("job_applications")
    .update({ is_archived: true, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
