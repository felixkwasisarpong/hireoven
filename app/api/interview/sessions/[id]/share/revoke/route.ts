import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres/server"

export const runtime = "nodejs"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json().catch(() => ({})) as { shareId?: string }
  if (!body.shareId) return NextResponse.json({ error: "shareId required" }, { status: 400 })

  const pool = getPostgresPool()
  const result = await pool.query(
    `UPDATE interview_shared_links
     SET revoked_at = NOW()
     WHERE id = $1
       AND session_id = $2
       AND user_id = $3
       AND revoked_at IS NULL`,
    [body.shareId, id, user.id]
  )

  if ((result as unknown as { rowCount: number }).rowCount === 0) {
    return NextResponse.json({ error: "Share link not found or already revoked" }, { status: 404 })
  }

  return NextResponse.json({ ok: true })
}
