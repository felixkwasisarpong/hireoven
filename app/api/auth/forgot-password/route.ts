import { createHash, randomBytes } from "crypto"
import { NextResponse } from "next/server"
import { Resend } from "resend"
import { getPostgresPool } from "@/lib/postgres/server"
import { getPublicSiteUrl } from "@/lib/waitlist/site-url"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { email?: string }
  const email = body.email?.trim().toLowerCase()
  if (!email) {
    return NextResponse.json({ ok: true })
  }

  const pool = getPostgresPool()
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM auth.users WHERE lower(trim(email)) = $1 LIMIT 1`,
    [email]
  )
  const userId = rows[0]?.id
  if (!userId) {
    return NextResponse.json({ ok: true })
  }

  const raw = randomBytes(32).toString("hex")
  const tokenHash = createHash("sha256").update(raw).digest("hex")
  const expires = new Date(Date.now() + 60 * 60 * 1000)

  await pool.query(
    `INSERT INTO auth.email_tokens (user_id, email, token_hash, token_type, expires_at)
     VALUES ($1, $2, $3, 'password_reset', $4)`,
    [userId, email, tokenHash, expires.toISOString()]
  )

  const site = getPublicSiteUrl()
  const link = `${site}/reset-password?token=${encodeURIComponent(raw)}`

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn("[auth] RESEND_API_KEY missing — password reset link not emailed:", link)
    return NextResponse.json({ ok: true })
  }

  const fromDomain =
    process.env.MAIL_FROM_DOMAIN?.trim() ||
    process.env.RESEND_FROM_DOMAIN?.trim() ||
    "hireoven.com"
  const resend = new Resend(apiKey)
  const { error } = await resend.emails.send({
    from: `Hireoven <noreply@${fromDomain}>`,
    to: email,
    subject: "Reset your Hireoven password",
    html: `<p>We received a request to reset your password.</p><p><a href="${link}">Set a new password</a> (expires in one hour).</p><p>If you didn’t ask for this, you can ignore this email.</p>`,
  })

  if (error) {
    console.error("[auth] Resend error", error)
  }

  return NextResponse.json({ ok: true })
}
