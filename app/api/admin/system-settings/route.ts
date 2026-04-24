import { NextRequest, NextResponse } from "next/server"
import { assertAdminAccess } from "@/lib/admin/auth"
import { getPostgresPool } from "@/lib/postgres/server"

export async function GET() {
  const access = await assertAdminAccess()
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const pool = getPostgresPool()
  const result = await pool.query(`SELECT key, value, updated_at, updated_by FROM system_settings ORDER BY updated_at DESC`)
  return NextResponse.json({ settings: result.rows })
}

export async function POST(request: NextRequest) {
  const access = await assertAdminAccess()
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const body = (await request.json().catch(() => ({}))) as { key?: string; value?: unknown }
  if (!body.key) return NextResponse.json({ error: "key is required" }, { status: 400 })

  const pool = getPostgresPool()
  await pool.query(
    `INSERT INTO system_settings (key, value, updated_by, updated_at)
     VALUES ($1, $2::jsonb, $3, now())
     ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value,
           updated_by = EXCLUDED.updated_by,
           updated_at = now()`,
    [body.key, JSON.stringify(body.value ?? null), access.profile.id]
  )
  return NextResponse.json({ ok: true })
}
