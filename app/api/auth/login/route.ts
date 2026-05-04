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
      is_admin: boolean | null
      suspended_at: string | null
    }>(
      `SELECT u.id,
              u.encrypted_password,
              u.email,
              p.is_admin,
              p.suspended_at
       FROM auth.users u
       LEFT JOIN profiles p ON p.id = u.id
       WHERE lower(trim(u.email)) = $1
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

    if (row.suspended_at) {
      return NextResponse.json({ error: "Account suspended" }, { status: 403 })
    }

    await pool.query(
      `UPDATE auth.users SET last_sign_in_at = now(), updated_at = now() WHERE id = $1`,
      [row.id]
    )

    const sessionEmail = row.email?.trim().toLowerCase() ?? email
    const token = await signSessionJwt({
      sub: row.id,
      email: sessionEmail,
      isAdmin: Boolean(row.is_admin),
      suspended: false,
    })
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
