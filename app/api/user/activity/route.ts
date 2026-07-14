import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres/server"

// Called by the dashboard layout on mount (client-side, throttled by localStorage).
// Server-side guard: only writes if last_active_at is null or > 5 minutes old,
// so even if the client misbehaves we write at most once per 5 min per user.
export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const pool = getPostgresPool()
  await pool.query(
    `UPDATE profiles
        SET last_active_at = now()
      WHERE id = $1
        AND (last_active_at IS NULL OR last_active_at < now() - interval '5 minutes')`,
    [user.id],
  )

  return NextResponse.json({ ok: true })
}
