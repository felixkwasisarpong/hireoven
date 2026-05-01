/**
 * PATCH  /api/scout/memory/[id]  — update summary, confidence, or active flag
 * DELETE /api/scout/memory/[id]  — permanently delete a memory
 */

import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { updateMemory, deleteMemory } from "@/lib/scout/memory/store"

export const runtime = "nodejs"

type RouteContext = { params: Promise<{ id: string }> }

export async function PATCH(request: Request, { params }: RouteContext) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params

  type Body = { summary?: string; confidence?: number; active?: boolean }
  const body = (await request.json().catch(() => null)) as Body | null
  if (!body || Object.keys(body).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 })
  }

  const pool = getPostgresPool()
  const updated = await updateMemory(id, user.id, pool, body)
  if (!updated) {
    return NextResponse.json({ error: "Memory not found or invalid input" }, { status: 404 })
  }

  return NextResponse.json({ memory: updated })
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const pool = getPostgresPool()
  const deleted = await deleteMemory(id, user.id, pool)

  if (!deleted) {
    return NextResponse.json({ error: "Memory not found" }, { status: 404 })
  }

  return NextResponse.json({ ok: true })
}
