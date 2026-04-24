import { NextRequest, NextResponse } from "next/server"
import { getPostgresPool } from "@/lib/postgres/server"
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
  const pool = getPostgresPool()

  const body = await request.json().catch(() => ({})) as {
    type?: string
    note?: string
    date?: string
  }

  const currentResult = await pool.query<{ timeline: unknown[] | null }>(
    `SELECT timeline
     FROM job_applications
     WHERE id = $1
       AND user_id = $2
     LIMIT 1`,
    [id, user.id]
  )
  const current = currentResult.rows[0]

  if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const entry = {
    id: randomUUID(),
    type: body.type ?? "note",
    note: body.note ?? null,
    date: body.date ?? new Date().toISOString(),
    auto: false,
  }

  const updated = [...((current.timeline as unknown[]) ?? []), entry]

  const updatedResult = await pool.query<{ timeline: unknown[] | null }>(
    `UPDATE job_applications
     SET timeline = $1::jsonb, updated_at = $2
     WHERE id = $3
       AND user_id = $4
     RETURNING timeline`,
    [JSON.stringify(updated), new Date().toISOString(), id, user.id]
  )
  const data = updatedResult.rows[0]

  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 })
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
  const pool = getPostgresPool()

  const entryId = request.nextUrl.searchParams.get("entryId")
  if (!entryId) return NextResponse.json({ error: "entryId required" }, { status: 400 })

  const currentResult = await pool.query<{ timeline: Array<{ id?: string; auto?: boolean }> | null }>(
    `SELECT timeline
     FROM job_applications
     WHERE id = $1
       AND user_id = $2
     LIMIT 1`,
    [id, user.id]
  )
  const current = currentResult.rows[0]

  if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 })

  // Only allow deleting manual entries (auto: false)
  const updated = ((current.timeline as Array<{ id?: string; auto?: boolean }> | null) ?? []).filter(
    (e) => !(e.id === entryId && !e.auto)
  )

  await pool.query(
    `UPDATE job_applications
     SET timeline = $1::jsonb, updated_at = $2
     WHERE id = $3
       AND user_id = $4`,
    [JSON.stringify(updated), new Date().toISOString(), id, user.id]
  )
  return NextResponse.json({ ok: true })
}
