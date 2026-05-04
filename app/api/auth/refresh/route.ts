import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { getSessionUser } from "@/lib/auth/session-user"
import { signSessionJwt, getSessionTokenSecondsLeft } from "@/lib/auth/jwt"
import { buildSessionSetCookie } from "@/lib/auth/session-cookie"
import { SESSION_COOKIE_NAME } from "@/lib/auth/constants"

export const runtime = "nodejs"

const SESSION_MAX_AGE = 60 * 60 * 24 * 14   // 14 days
const REFRESH_THRESHOLD = 60 * 60 * 24 * 7  // renew when < 7 days left

export async function POST() {
  const user = await getSessionUser()
  if (!user) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }

  const store = await cookies()
  const rawToken = store.get(SESSION_COOKIE_NAME)?.value
  if (!rawToken) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }

  const secondsLeft = await getSessionTokenSecondsLeft(rawToken)
  if (secondsLeft > REFRESH_THRESHOLD) {
    return NextResponse.json({ ok: true, renewed: false })
  }

  const newToken = await signSessionJwt(
    { sub: user.sub, email: user.email, isAdmin: user.isAdmin, suspended: user.suspended },
    SESSION_MAX_AGE
  )

  const res = NextResponse.json({ ok: true, renewed: true })
  res.headers.append("Set-Cookie", buildSessionSetCookie(newToken, SESSION_MAX_AGE))
  return res
}
