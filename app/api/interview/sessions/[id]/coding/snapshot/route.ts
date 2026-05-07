import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres/server"

export const runtime = "nodejs"

const MAX_SNAPSHOTS = 240
const MIN_INTERVAL_MS = 4000

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json().catch(() => ({})) as { code?: string }
  const code = body.code ?? ""

  const pool = getPostgresPool()

  // Verify ownership via session
  const attempt = await pool.query<{ id: string; code_snapshots: Array<{ ts: number; code: string }> }>(
    `SELECT ca.id, ca.code_snapshots
     FROM coding_attempts ca
     JOIN interview_sessions s ON s.id = ca.session_id
     WHERE s.id = $1 AND s.user_id = $2
     LIMIT 1`,
    [id, user.id]
  )

  if (!attempt.rows[0]) return NextResponse.json({ ok: true }) // silently ignore

  const snapshots = attempt.rows[0].code_snapshots ?? []

  // Throttle: drop if last snapshot is < 4s old
  const lastTs = snapshots[snapshots.length - 1]?.ts ?? 0
  if (Date.now() - lastTs < MIN_INTERVAL_MS) {
    return NextResponse.json({ ok: true })
  }

  // Evict oldest if at cap
  const newSnapshot = { ts: Date.now(), code }
  let updated = [...snapshots, newSnapshot]
  if (updated.length > MAX_SNAPSHOTS) {
    updated = updated.slice(updated.length - MAX_SNAPSHOTS)
  }

  await pool.query(
    `UPDATE coding_attempts SET code_snapshots = $1::jsonb WHERE id = $2`,
    [JSON.stringify(updated), attempt.rows[0].id]
  )

  return NextResponse.json({ ok: true })
}
