import { NextResponse } from "next/server"
import { getSessionUser } from "@/lib/auth/session-user"
import { getPostgresPool } from "@/lib/postgres/server"

export const runtime = "nodejs"

export async function GET() {
  const session = await getSessionUser()
  if (!session) {
    return NextResponse.json({
      authenticated: false,
      isAdmin: false,
      suspended: false,
    })
  }

  try {
    const pool = getPostgresPool()
    const { rows } = await pool.query<{ is_admin: boolean; suspended_at: string | null }>(
      `SELECT is_admin, suspended_at FROM profiles WHERE id = $1::uuid LIMIT 1`,
      [session.sub]
    )
    const row = rows[0]

    return NextResponse.json({
      authenticated: true,
      isAdmin: Boolean(row?.is_admin),
      suspended: Boolean(row?.suspended_at),
    })
  } catch {
    return NextResponse.json({
      authenticated: true,
      isAdmin: false,
      suspended: false,
    })
  }
}
