import { NextResponse } from "next/server"
import { upsertMarketingSubscriber } from "@/lib/marketing/subscribers"
import { createAdminClient } from "@/lib/supabase/admin"
import { getPublicSiteUrl } from "@/lib/waitlist/site-url"

/** One-click unsubscribe from waitlist marketing (metadata flag). */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const token = searchParams.get("token")?.trim()
  const site = getPublicSiteUrl()
  if (!token) {
    return NextResponse.redirect(new URL("/launch", site))
  }

  let supabase
  try {
    supabase = createAdminClient()
  } catch {
    return NextResponse.redirect(new URL("/launch", site))
  }

  const { data: row } = await supabase
    .from("waitlist")
    .select("id, email, metadata")
    .eq("confirmation_token", token)
    .maybeSingle()

  if (!row) {
    return NextResponse.redirect(new URL("/launch", site))
  }

  const meta = {
    ...(row.metadata && typeof row.metadata === "object" ? row.metadata : {}),
    marketing_unsubscribed: true,
    marketing_unsubscribed_at: new Date().toISOString(),
  }

  await supabase.from("waitlist").update({ metadata: meta }).eq("id", row.id)
  if (row.email) {
    await upsertMarketingSubscriber({
      email: row.email,
      source: "waitlist_unsubscribe",
      metadata: { unsubscribed_from_waitlist: true },
    })
    await ((supabase.from("marketing_subscribers") as any)
      .update({
        subscribed_to_marketing: false,
        unsubscribed_at: new Date().toISOString(),
      })
      .eq("email", row.email.toLowerCase()))
  }

  return NextResponse.redirect(new URL("/launch?unsubscribed=1", site))
}
