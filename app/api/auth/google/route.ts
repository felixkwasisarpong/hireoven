import { NextRequest, NextResponse } from "next/server"
import { signOAuthStateJwt } from "@/lib/auth/jwt"

function sanitizeNext(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/dashboard"
  return next
}

export async function GET(request: NextRequest) {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim()
  const secret = process.env.GOOGLE_CLIENT_SECRET?.trim()
  if (!clientId || !secret) {
    return NextResponse.json({ error: "Google sign-in is not configured" }, { status: 503 })
  }

  const next = sanitizeNext(request.nextUrl.searchParams.get("next"))
  const state = await signOAuthStateJwt({ next })
  const origin = new URL(request.url).origin
  const redirectUri = `${origin}/api/auth/google/callback`

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth")
  url.searchParams.set("client_id", clientId)
  url.searchParams.set("redirect_uri", redirectUri)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("scope", "openid email profile")
  url.searchParams.set("state", state)
  url.searchParams.set("access_type", "online")

  return NextResponse.redirect(url.toString())
}
