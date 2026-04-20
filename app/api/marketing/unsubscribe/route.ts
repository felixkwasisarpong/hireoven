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
