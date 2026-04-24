import { randomUUID } from "crypto"
import { NextRequest, NextResponse } from "next/server"
import { signSessionJwt, verifyOAuthStateJwt } from "@/lib/auth/jwt"
import { buildSessionSetCookie } from "@/lib/auth/session-cookie"
import { getPostgresPool } from "@/lib/postgres/server"

export const runtime = "nodejs"

export async function GET(request: NextRequest) {
  const url = request.nextUrl
  const err = url.searchParams.get("error")
  if (err) {
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(err)}`, url.origin)
    )
  }

  const code = url.searchParams.get("code")
  const state = url.searchParams.get("state")
  if (!code || !state) {
    return NextResponse.redirect(new URL("/login?error=missing_code", url.origin))
  }

  const claims = await verifyOAuthStateJwt(state)
  if (!claims) {
    return NextResponse.redirect(new URL("/login?error=invalid_state", url.origin))
  }

  const clientId = process.env.GOOGLE_CLIENT_ID?.trim()
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim()
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(new URL("/login?error=oauth_not_configured", url.origin))
  }

  const redirectUri = `${url.origin}/api/auth/google/callback`
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  })

  if (!tokenRes.ok) {
    return NextResponse.redirect(new URL("/login?error=oauth_token", url.origin))
  }

  const tokens = (await tokenRes.json()) as { access_token?: string }
  if (!tokens.access_token) {
    return NextResponse.redirect(new URL("/login?error=oauth_token", url.origin))
  }

  const profileRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  })
  if (!profileRes.ok) {
    return NextResponse.redirect(new URL("/login?error=userinfo", url.origin))
  }

  const profile = (await profileRes.json()) as {
    sub: string
    email?: string
    name?: string
    picture?: string
  }
  if (!profile.email) {
    return NextResponse.redirect(new URL("/login?error=no_email", url.origin))
  }

  const email = profile.email.trim().toLowerCase()
  const pool = getPostgresPool()

  let userId: string | null = null
  const existingGoogle = await pool.query<{ id: string }>(
    `SELECT id FROM auth.users WHERE google_sub = $1 LIMIT 1`,
    [profile.sub]
  )
  if (existingGoogle.rows[0]) {
    userId = existingGoogle.rows[0].id
  } else {
    const byEmail = await pool.query<{ id: string; google_sub: string | null }>(
      `SELECT id, google_sub FROM auth.users WHERE lower(trim(email)) = $1 LIMIT 1`,
      [email]
    )
    const row = byEmail.rows[0]
    if (row) {
      userId = row.id
      if (!row.google_sub) {
        await pool.query(`UPDATE auth.users SET google_sub = $1, updated_at = now() WHERE id = $2`, [
          profile.sub,
          row.id,
        ])
      }
    } else {
      userId = randomUUID()
      const client = await pool.connect()
      try {
        await client.query("BEGIN")
        await client.query(
          `INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, google_sub, created_at, updated_at)
           VALUES ($1, $2, NULL, now(), $3, now(), now())`,
          [userId, email, profile.sub]
        )
        await client.query(
          `INSERT INTO profiles (id, email, full_name, avatar_url)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (id) DO UPDATE
             SET email = COALESCE(EXCLUDED.email, profiles.email),
                 full_name = COALESCE(EXCLUDED.full_name, profiles.full_name),
                 avatar_url = COALESCE(EXCLUDED.avatar_url, profiles.avatar_url),
                 updated_at = now()`,
          [userId, email, profile.name ?? null, profile.picture ?? null]
        )
        await client.query("COMMIT")
      } catch {
        await client.query("ROLLBACK").catch(() => {})
        return NextResponse.redirect(new URL("/login?error=signup_failed", url.origin))
      } finally {
        client.release()
      }
    }
  }

  const suspended = await pool.query<{ suspended_at: string | null }>(
    `SELECT suspended_at FROM profiles WHERE id = $1 LIMIT 1`,
    [userId]
  )
  if (suspended.rows[0]?.suspended_at) {
    return NextResponse.redirect(new URL("/login?reason=suspended", url.origin))
  }

  await pool.query(
    `UPDATE auth.users SET last_sign_in_at = now(), updated_at = now() WHERE id = $1`,
    [userId]
  )

  const sessionToken = await signSessionJwt({ sub: userId!, email })
  const res = NextResponse.redirect(new URL(claims.next, url.origin))
  res.headers.append("Set-Cookie", buildSessionSetCookie(sessionToken, 60 * 60 * 24 * 14))
  return res
}
