import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { getSessionUser } from "@/lib/auth/session-user"
import { signSessionJwt, getSessionTokenSecondsLeft } from "@/lib/auth/jwt"
import {
  buildSessionSetCookie,
  clearSessionCookieHeader,
  clearSessionFlagsCookieHeader,
} from "@/lib/auth/session-cookie"
import { SESSION_COOKIE_NAME } from "@/lib/auth/constants"
import { getPostgresPool } from "@/lib/postgres/server"

export const runtime = "nodejs"

const SESSION_MAX_AGE = 60 * 60 * 24 * 14   // 14 days
const REFRESH_THRESHOLD = 60 * 60 * 24 * 7  // renew when < 7 days left

export async function POST() {
  const user = await getSessionUser()
  if (!user) {
    return NextResponse.json({ ok: false, authenticated: false })
  }

  const store = await cookies()
  const rawToken = store.get(SESSION_COOKIE_NAME)?.value
  if (!rawToken) {
    return NextResponse.json({ ok: false, authenticated: false })
  }

  // Read the live flags before renewing anything. `user` comes from the token
  // we are about to replace, so renewing off it would roll a stale
  // `suspended: false` forward into a fresh 14-day session, indefinitely.
  let isAdmin = user.isAdmin ?? false
  let suspended = user.suspended ?? false
  try {
    const pool = getPostgresPool()
    const { rows } = await pool.query<{ is_admin: boolean; suspended_at: string | null }>(
      `SELECT is_admin, suspended_at FROM profiles WHERE id = $1::uuid LIMIT 1`,
      [user.sub]
    )
    const row = rows[0]
    isAdmin = Boolean(row?.is_admin)
    suspended = !row || Boolean(row.suspended_at)
  } catch {
    // Fall through on the token's claims rather than ending a live session
    // because one lookup failed.
  }

  if (suspended) {
    const res = NextResponse.json({ ok: false, authenticated: false, suspended: true }, { status: 403 })
    res.headers.append("Set-Cookie", clearSessionCookieHeader())
    res.headers.append("Set-Cookie", clearSessionFlagsCookieHeader())
    return res
  }

  const secondsLeft = await getSessionTokenSecondsLeft(rawToken)
  if (secondsLeft > REFRESH_THRESHOLD) {
    return NextResponse.json({ ok: true, renewed: false })
  }

  const newToken = await signSessionJwt(
    { sub: user.sub, email: user.email, isAdmin, suspended: false },
    SESSION_MAX_AGE
  )

  const res = NextResponse.json({ ok: true, renewed: true })
  res.headers.append("Set-Cookie", buildSessionSetCookie(newToken, SESSION_MAX_AGE))
  return res
}
