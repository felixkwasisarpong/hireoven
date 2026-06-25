import { NextRequest, NextResponse } from "next/server"
import { applyUnsubscribe } from "@/lib/email/unsubscribe"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// RFC 8058 one-click unsubscribe target (referenced by the List-Unsubscribe header).
// POST = the mail client's automatic one-click; GET = a human following the link,
// which applies and redirects to the confirmation page. No auth — the token is the
// capability. Applies in well under 5 seconds.

function tokenFrom(request: NextRequest): string | null {
  return new URL(request.url).searchParams.get("token")
}

export async function POST(request: NextRequest) {
  const token = tokenFrom(request)
  if (!token) return NextResponse.json({ error: "missing token" }, { status: 400 })
  const { applied, email_type } = await applyUnsubscribe(token)
  return NextResponse.json({ applied, email_type })
}

export async function GET(request: NextRequest) {
  const token = tokenFrom(request)
  if (!token) return NextResponse.redirect(new URL("/unsubscribe", request.url))
  await applyUnsubscribe(token)
  return NextResponse.redirect(new URL(`/unsubscribe?token=${token}&done=1`, request.url))
}
