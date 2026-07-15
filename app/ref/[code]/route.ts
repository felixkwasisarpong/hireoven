import { NextRequest, NextResponse } from "next/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { getUserIdByReferralCode } from "@/lib/referral/codes"

export const runtime = "nodejs"

export async function GET(
  request: NextRequest,
  { params }: { params: { code: string } }
) {
  const origin = new URL(request.url).origin
  const code = params.code?.toUpperCase()

  if (!code) {
    return NextResponse.redirect(new URL("/signup", origin))
  }

  const pool = getPostgresPool()
  const referrerId = await getUserIdByReferralCode(pool, code).catch(() => null)

  if (!referrerId) {
    // Invalid code — send to signup without cookie
    return NextResponse.redirect(new URL("/signup", origin))
  }

  const res = NextResponse.redirect(new URL("/signup?ref=1", origin))
  // Not HttpOnly — client JS can clear it after claim
  res.headers.append(
    "Set-Cookie",
    `hireoven_ref=${code}; Path=/; Max-Age=${60 * 60 * 24 * 30}; SameSite=Lax${process.env.NODE_ENV === "production" ? "; Secure" : ""}`
  )
  return res
}
