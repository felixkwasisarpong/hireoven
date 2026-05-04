import { NextResponse } from "next/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { createClient } from "@/lib/supabase/server"
import type { CoverLetterUpdate } from "@/types"

export const runtime = "nodejs"

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const pool = getPostgresPool()

  const body = await request.json().catch(() => ({})) as CoverLetterUpdate

  const allowed = new Set([
    "hiring_manager",
    "subject_line",
    "body",
    "word_count",
    "tone",
    "length",
    "style",
    "is_favorite",
    "was_used",
    "mentions_sponsorship",
    "sponsorship_approach",
  ])
  const entries = Object.entries(body).filter(([key]) => allowed.has(key))
  if (entries.length === 0) {
    return NextResponse.json({ error: "No valid updates provided" }, { status: 400 })
  }

  const values: unknown[] = []
  const setSql = entries.map(([key, value], idx) => {
    values.push(value)
    return `${key} = $${idx + 1}`
  })
  values.push(new Date().toISOString(), params.id, user.id)

  try {
    const result = await pool.query(
      `UPDATE cover_letters
       SET ${setSql.join(", ")}, updated_at = $${values.length - 2}
       WHERE id = $${values.length - 1}
         AND user_id = $${values.length}
       RETURNING *`,
      values
    )
    const data = result.rows[0]
    if (!data) return NextResponse.json({ error: "Cover letter not found" }, { status: 404 })
    return NextResponse.json(data)
  } catch (err) {
    console.error("[cover-letter PATCH] failed", { id: params.id, fields: entries.map(([k]) => k), error: err })
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Database error" },
      { status: 500 }
    )
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const pool = getPostgresPool()

  await pool.query(
    `DELETE FROM cover_letters
     WHERE id = $1
       AND user_id = $2`,
    [params.id, user.id]
  )
  return NextResponse.json({ success: true })
}
