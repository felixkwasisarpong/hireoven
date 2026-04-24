import type { NextRequest } from "next/server"
import { cookies } from "next/headers"
import { SESSION_COOKIE_NAME } from "@/lib/auth/constants"
import { readSessionTokenFromCookieHeader, verifySessionJwt, type AppSessionClaims } from "@/lib/auth/jwt"

export type SessionUser = AppSessionClaims

export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE_NAME)?.value
  if (!token) return null
  return verifySessionJwt(token)
}

export async function getSessionUserFromRequest(request: NextRequest): Promise<SessionUser | null> {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value
  if (!token) return null
  return verifySessionJwt(token)
}

/** For Route Handlers that receive a plain `Request` (no NextRequest cookies helper). */
export async function getSessionUserFromRequestHeaders(request: Request): Promise<SessionUser | null> {
  const raw = request.headers.get("cookie")
  const token = readSessionTokenFromCookieHeader(raw)
  if (!token) return null
  return verifySessionJwt(token)
}
