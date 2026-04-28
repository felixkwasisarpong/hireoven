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

  return NextResponse.json(
    {
      authenticated: true,
      user: { id: user.sub, email: user.email },
    },
    { status: 200, headers }
  )
}
