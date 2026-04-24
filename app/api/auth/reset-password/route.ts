import { createHash } from "crypto"
import { NextResponse } from "next/server"
import { hashPassword } from "@/lib/auth/password"
import { getPostgresPool } from "@/lib/postgres/server"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { token?: string; password?: string }
  const password = body.password
  const token = body.token
  if (!password || password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 })
  }
  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 })
  }

  const tokenHash = createHash("sha256").update(token).digest("hex")
  const pool = getPostgresPool()
  const client = await pool.connect()

  try {
    await client.query("BEGIN")
    const { rows } = await client.query<{ id: string; user_id: string | null }>(
      `SELECT id, user_id FROM auth.email_tokens
       WHERE token_hash = $1
         AND token_type = 'password_reset'
         AND consumed_at IS NULL
         AND expires_at > now()
       LIMIT 1
       FOR UPDATE`,
      [tokenHash]
    )
    const row = rows[0]
    if (!row?.user_id) {
      await client.query("ROLLBACK")
      return NextResponse.json({ error: "Invalid or expired link" }, { status: 400 })
    }

    const hashed = await hashPassword(password)
    await client.query(`UPDATE auth.users SET encrypted_password = $1, updated_at = now() WHERE id = $2`, [
      hashed,
      row.user_id,
    ])
    await client.query(`UPDATE auth.email_tokens SET consumed_at = now() WHERE id = $1`, [row.id])
    await client.query("COMMIT")
    return NextResponse.json({ ok: true })
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {})
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Reset failed" },
      { status: 500 }
    )
  } finally {
    client.release()
  }
}
