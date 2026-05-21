import { NextRequest, NextResponse } from "next/server"
import { signOAuthStateJwt } from "@/lib/auth/jwt"

export const runtime = "nodejs"

function sanitizeNext(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/dashboard"
  return next
}

/** Returns the canonical public origin (no trailing slash).
 *  NEXT_PUBLIC_APP_URL must be set in production to the exact origin
 *  registered as an authorised redirect URI in Google Cloud Console.
 *  Falls back to the request origin in local dev where no proxy is involved. */
function getAppOrigin(request: NextRequest): string {
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "")
  if (fromEnv) return fromEnv
  return new URL(request.url).origin
}

export async function GET(request: NextRequest) {
  // Waitlist gate: same flag the signup route honors. Block Google sign-in
  // so it can't be used as a side door around the invite requirement.
  if (process.env.WAITLIST_ONLY === "true") {
    const origin = getAppOrigin(request)
    return NextResponse.redirect(`${origin}/login?error=waitlist`)
  }

  const clientId = process.env.GOOGLE_CLIENT_ID?.trim()
  const secret = process.env.GOOGLE_CLIENT_SECRET?.trim()
  if (!clientId || !secret) {
    return NextResponse.json({ error: "Google sign-in is not configured" }, { status: 503 })
  }

  const next = sanitizeNext(request.nextUrl.searchParams.get("next"))
  const state = await signOAuthStateJwt({ next })
  const redirectUri = `${getAppOrigin(request)}/api/auth/google/callback`

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth")
  url.searchParams.set("client_id", clientId)
  url.searchParams.set("redirect_uri", redirectUri)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("scope", "openid email profile")
  url.searchParams.set("state", state)
  url.searchParams.set("access_type", "online")
  url.searchParams.set("prompt", "select_account")

  return NextResponse.redirect(url.toString())
}
