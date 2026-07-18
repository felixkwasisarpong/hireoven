import { NextResponse } from "next/server"
import { unsubscribeMarketingByToken } from "@/lib/marketing/subscribers"
import { getPublicSiteUrl } from "@/lib/waitlist/site-url"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const token = searchParams.get("token")?.trim()
  const site = getPublicSiteUrl()

  if (!token) {
    return NextResponse.redirect(new URL("/?unsubscribed=0", site))
  }

  const result = await unsubscribeMarketingByToken(token)
  if (!result) {
    return NextResponse.redirect(new URL("/?unsubscribed=0", site))
  }

  return NextResponse.redirect(new URL("/?unsubscribed=1", site))
}

// RFC 8058 one-click unsubscribe. Mail clients (Gmail, Apple Mail) POST here
// directly from the List-Unsubscribe header, and expect a 200 — not a redirect.
export async function POST(request: Request) {
  const { searchParams } = new URL(request.url)
  const token = searchParams.get("token")?.trim()
  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 })
  }
  await unsubscribeMarketingByToken(token)
  // Always 200 on a well-formed request: an unknown/already-used token still
  // means "this address should not receive mail", which is the desired end state.
  return NextResponse.json({ ok: true })
}
