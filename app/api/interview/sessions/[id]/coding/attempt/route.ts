import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres/server"

export const runtime = "nodejs"

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json().catch(() => ({})) as { languageUsed?: string }
  if (!body.languageUsed) return NextResponse.json({ error: "languageUsed required" }, { status: 400 })

  const pool = getPostgresPool()

  await pool.query(
    `UPDATE coding_attempts ca
     SET language_used = $1::coding_language
     FROM interview_sessions s
     WHERE ca.session_id = s.id AND s.id = $2 AND s.user_id = $3`,
    [body.languageUsed, id, user.id]
  )

  return NextResponse.json({ ok: true })
}
