import { NextResponse } from "next/server"
import { buildSessionSetCookie } from "@/lib/auth/session-cookie"
import { signSessionJwt } from "@/lib/auth/jwt"
import { verifyPassword } from "@/lib/auth/password"
import { getPostgresPool } from "@/lib/postgres/server"

export const runtime = "nodejs"

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      email?: string
      password?: string
    }
    const email = body.email?.trim().toLowerCase()
    const password = body.password
    if (!email || !password) {
      return NextResponse.json({ error: "Email and password required" }, { status: 400 })
    }

    const pool = getPostgresPool()
    const { rows } = await pool.query<{
      id: string
      encrypted_password: string | null
      email: string | null
    }>(
      `SELECT id, encrypted_password, email
       FROM auth.users
       WHERE lower(trim(email)) = $1
       LIMIT 1`,
      [email]
    )
    const row = rows[0]
    if (!row?.encrypted_password) {
      return NextResponse.json({ error: "Incorrect email or password." }, { status: 401 })
    }

    const ok = await verifyPassword(password, row.encrypted_password)
    if (!ok) {
      return NextResponse.json({ error: "Incorrect email or password." }, { status: 401 })
    }

    const suspended = await pool.query<{ suspended_at: string | null }>(
      `SELECT suspended_at FROM profiles WHERE id = $1 LIMIT 1`,
      [row.id]
    )
    if (suspended.rows[0]?.suspended_at) {
      return NextResponse.json({ error: "Account suspended" }, { status: 403 })
    }

    await pool.query(
      `UPDATE auth.users SET last_sign_in_at = now(), updated_at = now() WHERE id = $1`,
      [row.id]
    )

    const sessionEmail = row.email?.trim().toLowerCase() ?? email
    const token = await signSessionJwt({ sub: row.id, email: sessionEmail })
    const res = NextResponse.json({ ok: true, user: { id: row.id, email: sessionEmail } })
    res.headers.append("Set-Cookie", buildSessionSetCookie(token, 60 * 60 * 24 * 14))
    return res
  } catch (error) {
    console.error("Login failed", error)
    return NextResponse.json(
      { error: "Auth service unavailable. Please check database connectivity and try again." },
      { status: 503 }
    )
  }
}
