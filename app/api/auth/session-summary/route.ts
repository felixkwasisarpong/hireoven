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

  // Always read the flags from Postgres. Echoing back the claims on the session
  // JWT would defeat the point: that token is signed at login and lives for two
  // weeks, so a suspension (or an admin grant, or a revoked one) made after it
  // was issued would not show up here until the user signed in again.
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
      // A session whose profile row is gone is not a live account either.
      suspended: !row || Boolean(row.suspended_at),
    })
  } catch {
    // Database unreachable: fall back to the session's own claims rather than
    // reporting every user as suspended and signing the whole app out.
    return NextResponse.json({
      authenticated: true,
      isAdmin: session.isAdmin ?? false,
      suspended: session.suspended ?? false,
    })
  }
}
