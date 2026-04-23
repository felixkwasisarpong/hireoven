import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

function getPublicAppOrigin(requestOrigin: string) {
  const runtime = requestOrigin.trim()
  if (runtime) return runtime.replace(/\/$/, "")

  const configured =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim()
  return (configured || requestOrigin).replace(/\/$/, "")
}

function sanitizeNextPath(next: string | null): string | null {
  if (!next) return null
  if (!next.startsWith("/") || next.startsWith("//")) return null
  return next
}

export async function GET(request: Request) {
  const { searchParams, origin: requestOrigin } = new URL(request.url)
  const origin = getPublicAppOrigin(requestOrigin)
  const code = searchParams.get("code")
  const next = sanitizeNextPath(searchParams.get("next"))
  const providerError =
    searchParams.get("error_description") || searchParams.get("error")

  if (providerError) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(providerError)}`
    )
  }

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      if (next) {
        return NextResponse.redirect(`${origin}${next}`)
      }

      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (user) {
        await ((supabase.from("profiles") as any).upsert({
          id: user.id,
          email: user.email ?? null,
          full_name: (user.user_metadata as { full_name?: string | null } | null)?.full_name ?? null,
        }))

        const { data: profile } = await ((supabase
          .from("profiles")
          .select("is_admin")
          .eq("id", user.id)
          .single()) as any)

        const destination = profile?.is_admin ? "/admin" : "/dashboard"
        return NextResponse.redirect(`${origin}${destination}`)
      }

      return NextResponse.redirect(`${origin}/dashboard`)
    }

    console.error("[auth/callback] exchangeCodeForSession failed", {
      message: error.message,
      status: error.status,
      code: error.code,
      requestOrigin,
      next,
    })

    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(
        "Could not complete Google sign in. Please try again."
      )}`
    )
  }

  return NextResponse.redirect(
    `${origin}/login?error=${encodeURIComponent(
      "Could not sign in with Google"
    )}`
  )
}
