import { randomUUID } from "crypto"
import { NextRequest, NextResponse } from "next/server"
import { signSessionJwt, verifyOAuthStateJwt } from "@/lib/auth/jwt"
import { buildSessionSetCookie } from "@/lib/auth/session-cookie"
import { getPostgresPool } from "@/lib/postgres/server"

export const runtime = "nodejs"

/** Must match getAppOrigin() in the initiation route exactly. */
function getAppOrigin(request: NextRequest): string {
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "")
  if (fromEnv) return fromEnv
  return new URL(request.url).origin
}

function loginError(origin: string, code: string) {
  return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(code)}`, origin))
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl
  const origin = getAppOrigin(request)

  const err = url.searchParams.get("error")
  if (err) return loginError(origin, err)

  const code = url.searchParams.get("code")
  const state = url.searchParams.get("state")
  if (!code || !state) return loginError(origin, "missing_code")

  const claims = await verifyOAuthStateJwt(state)
  if (!claims) return loginError(origin, "invalid_state")

  const clientId = process.env.GOOGLE_CLIENT_ID?.trim()
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim()
  if (!clientId || !clientSecret) return loginError(origin, "oauth_not_configured")

  const redirectUri = `${origin}/api/auth/google/callback`

  // Exchange code for tokens
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }),
  })
  if (!tokenRes.ok) return loginError(origin, "oauth_token")

  const tokens = (await tokenRes.json()) as { access_token?: string }
  if (!tokens.access_token) return loginError(origin, "oauth_token")

  // Fetch Google profile
  const profileRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  })
  if (!profileRes.ok) return loginError(origin, "userinfo")

  const googleProfile = (await profileRes.json()) as {
    sub: string
    email?: string
    name?: string
    picture?: string
  }
  if (!googleProfile.email) return loginError(origin, "no_email")

  const email = googleProfile.email.trim().toLowerCase()
  const pool = getPostgresPool()

  // Resolve or create user
  let userId: string | null = null

  const byGoogleSub = await pool.query<{ id: string }>(
    `SELECT id FROM auth.users WHERE google_sub = $1 LIMIT 1`,
    [googleProfile.sub]
  )
  if (byGoogleSub.rows[0]) {
    userId = byGoogleSub.rows[0].id
  } else {
    const byEmail = await pool.query<{ id: string; google_sub: string | null }>(
      `SELECT id, google_sub FROM auth.users WHERE lower(trim(email)) = $1 LIMIT 1`,
      [email]
    )
    const existing = byEmail.rows[0]
    if (existing) {
      userId = existing.id
      // Link google_sub to an existing email account
      if (!existing.google_sub) {
        await pool.query(
          `UPDATE auth.users SET google_sub = $1, updated_at = now() WHERE id = $2`,
          [googleProfile.sub, existing.id]
        )
      }
    } else {
      // New user — create account + profile in a transaction.
      // Waitlist gate: don't let Google sign-in be a side door around the
      // invite requirement. Existing Google users (matched above) still work.
      if (process.env.WAITLIST_ONLY === "true") {
        return NextResponse.redirect(new URL("/waitlist", origin))
      }
      userId = randomUUID()
      const client = await pool.connect()
      try {
        await client.query("BEGIN")
        await client.query(
          `INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, google_sub, created_at, updated_at)
           VALUES ($1, $2, NULL, now(), $3, now(), now())`,
          [userId, email, googleProfile.sub]
        )
        await client.query(
          `INSERT INTO profiles (id, email, full_name, avatar_url)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (id) DO UPDATE
             SET email      = COALESCE(EXCLUDED.email, profiles.email),
                 full_name  = COALESCE(EXCLUDED.full_name, profiles.full_name),
                 avatar_url = COALESCE(EXCLUDED.avatar_url, profiles.avatar_url),
                 updated_at = now()`,
          [userId, email, googleProfile.name ?? null, googleProfile.picture ?? null]
        )
        await client.query("COMMIT")
      } catch (e) {
        await client.query("ROLLBACK").catch(() => {})
        console.error("[google/callback] user creation failed", e)
        return loginError(origin, "signup_failed")
      } finally {
        client.release()
      }
    }
  }

  // Check suspension
  const flags = await pool.query<{ suspended_at: string | null; is_admin: boolean | null }>(
    `SELECT suspended_at, is_admin FROM profiles WHERE id = $1 LIMIT 1`,
    [userId!]
  )
  if (flags.rows[0]?.suspended_at) {
    return NextResponse.redirect(new URL("/login?reason=suspended", origin))
  }

  await pool.query(
    `UPDATE auth.users SET last_sign_in_at = now(), updated_at = now() WHERE id = $1`,
    [userId!]
  )

  const sessionToken = await signSessionJwt({
    sub: userId!,
    email,
    isAdmin: Boolean(flags.rows[0]?.is_admin),
    suspended: false,
  })

  const res = NextResponse.redirect(new URL(claims.next, origin))
  res.headers.append("Set-Cookie", buildSessionSetCookie(sessionToken, 60 * 60 * 24 * 14))
  return res
}
