import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { randomUUID } from "crypto"

export const runtime = "nodejs"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json().catch(() => ({})) as {
    type?: string
    note?: string
    date?: string
  }

  const { data: current } = await (supabase as any)
    .from("job_applications")
    .select("timeline")
    .eq("id", id)
    .eq("user_id", user.id)
    .single()

  if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const entry = {
    id: randomUUID(),
    type: body.type ?? "note",
    note: body.note ?? null,
    date: body.date ?? new Date().toISOString(),
    auto: false,
  }

  const updated = [...((current.timeline as unknown[]) ?? []), entry]

  const { data, error } = await (supabase as any)
    .from("job_applications")
    .update({ timeline: updated, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id)
    .select("timeline")
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ entry, timeline: data.timeline }, { status: 201 })
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const entryId = request.nextUrl.searchParams.get("entryId")
  if (!entryId) return NextResponse.json({ error: "entryId required" }, { status: 400 })

  const { data: current } = await (supabase as any)
    .from("job_applications")
    .select("timeline")
    .eq("id", id)
    .eq("user_id", user.id)
    .single()

  if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 })

  // Only allow deleting manual entries (auto: false)
  const updated = ((current.timeline as any[]) ?? []).filter(
    (e: any) => !(e.id === entryId && !e.auto)
  )

  const { error } = await (supabase as any)
    .from("job_applications")
    .update({ timeline: updated, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
