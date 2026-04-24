import { randomUUID } from "crypto"
import { NextResponse } from "next/server"
import { buildSessionSetCookie } from "@/lib/auth/session-cookie"
import { hashPassword } from "@/lib/auth/password"
import { signSessionJwt } from "@/lib/auth/jwt"
import { getPostgresPool } from "@/lib/postgres/server"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    email?: string
    password?: string
    full_name?: string
  }
  const email = body.email?.trim().toLowerCase()
  const password = body.password
  const fullName = body.full_name?.trim() || null
  if (!email || !password) {
    return NextResponse.json({ error: "Email and password required" }, { status: 400 })
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 })
  }

  const pool = getPostgresPool()
  const dup = await pool.query(`SELECT 1 FROM auth.users WHERE lower(trim(email)) = $1 LIMIT 1`, [email])
  if (dup.rowCount) {
    return NextResponse.json({ error: "An account with this email already exists." }, { status: 409 })
  }

  const id = randomUUID()
  const hashed = await hashPassword(password)

  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    await client.query(
      `INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at)
       VALUES ($1, $2, $3, now(), now(), now())`,
      [id, email, hashed]
    )
    await client.query(
      `INSERT INTO profiles (id, email, full_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE
         SET email = EXCLUDED.email,
             full_name = COALESCE(EXCLUDED.full_name, profiles.full_name),
             updated_at = now()`,
      [id, email, fullName]
    )
    await client.query("COMMIT")
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {})
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Signup failed" },
      { status: 500 }
    )
  } finally {
    client.release()
  }

  const token = await signSessionJwt({ sub: id, email })
  const res = NextResponse.json({ ok: true, user: { id, email } })
  res.headers.append("Set-Cookie", buildSessionSetCookie(token, 60 * 60 * 24 * 14))
  return res
}
