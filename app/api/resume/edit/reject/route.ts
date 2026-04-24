import { NextResponse } from "next/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { createClient } from "@/lib/supabase/server"

export const runtime = "nodejs"

type RejectBody = {
  editId?: string
  feedback?: string
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const pool = getPostgresPool()

  const body = (await request.json().catch(() => ({}))) as RejectBody
  if (!body.editId) {
    return NextResponse.json({ error: "editId is required" }, { status: 400 })
  }

  const result = await pool.query(
    `UPDATE resume_edits
     SET was_accepted = false,
         feedback = $1
     WHERE id = $2
       AND user_id = $3`,
    [typeof body.feedback === "string" ? body.feedback.trim() || null : null, body.editId, user.id]
  )

  if (result.rowCount === 0) {
    return NextResponse.json({ error: "Edit not found" }, { status: 404 })
  }

  return NextResponse.json({ success: true })
}
