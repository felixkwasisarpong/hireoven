/**
 * GET /api/extension/session/validate
 *
 * Validates the extension user's session.
 * Auth: Bearer <ho_session JWT> header (sent by the Chrome extension).
 */

import { NextResponse } from "next/server"
import {
  extensionCorsHeaders,
  getExtensionUser,
  handleExtensionPreflight,
} from "@/lib/extension/auth"
import { getPostgresPool } from "@/lib/postgres/server"

export const runtime = "nodejs"

export function OPTIONS(request: Request) {
  return handleExtensionPreflight(request)
}

export async function GET(request: Request) {
  const origin = request.headers.get("origin")
  const headers = extensionCorsHeaders(origin)

  const user = await getExtensionUser(request)

  if (!user) {
    return NextResponse.json(
      { authenticated: false, user: null },
      { status: 200, headers }
    )
  }

  let fullName: string | null = null
  let avatarUrl: string | null = null
  try {
    const pool = getPostgresPool()
    const pr = await pool.query<{ full_name: string | null; avatar_url: string | null }>(
      `SELECT full_name, avatar_url FROM profiles WHERE id = $1 LIMIT 1`,
      [user.sub]
    )
    const row = pr.rows[0]
    fullName = row?.full_name ?? null
    avatarUrl = row?.avatar_url ?? null
  } catch {
    /* profile optional */
  }

  return NextResponse.json(
    {
      authenticated: true,
      user: {
        id: user.sub,
        email: user.email,
        fullName,
        avatarUrl,
      },
    },
    { status: 200, headers }
  )
}
