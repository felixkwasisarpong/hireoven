import { NextResponse } from "next/server"
import { upsertMarketingSubscriber } from "@/lib/marketing/subscribers"
import { createAdminClient } from "@/lib/supabase/admin"
import { getPublicSiteUrl } from "@/lib/waitlist/site-url"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const token = searchParams.get("token")?.trim()
  if (!token) {
    return NextResponse.redirect(new URL("/launch", getPublicSiteUrl()))
  }

  let supabase
  try {
    supabase = createAdminClient()
  } catch {
    return NextResponse.redirect(
      new URL("/launch?error=confirm", getPublicSiteUrl())
    )
  }

  const { data: row } = await supabase
    .from("waitlist")
    .select("id, email")
    .eq("confirmation_token", token)
    .maybeSingle()

  if (!row) {
    return NextResponse.redirect(
      new URL("/launch?error=invalid-token", getPublicSiteUrl())
    )
  }

  await supabase
    .from("waitlist")
    .update({ confirmed: true })
    .eq("id", row.id)

  if (row.email) {
    await upsertMarketingSubscriber({
      email: row.email,
      source: "waitlist_confirmed",
      metadata: { waitlist_confirmed: true },
    })
  }

  const dest = new URL("/launch/confirmed", getPublicSiteUrl())
  dest.searchParams.set("token", token)
  return NextResponse.redirect(dest)
}
