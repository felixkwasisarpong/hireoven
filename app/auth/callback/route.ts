import { NextResponse } from "next/server"

/** Legacy path from older Supabase OAuth links. Google sign-in now uses `/api/auth/google`. */
export function GET(request: Request) {
  const origin = new URL(request.url).origin
  return NextResponse.redirect(
    `${origin}/login?notice=${encodeURIComponent("Use Continue with Google on the sign-in page.")}`
  )
}
