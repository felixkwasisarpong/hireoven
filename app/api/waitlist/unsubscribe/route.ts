import { NextResponse } from "next/server"
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
    .select("id, metadata")
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

  return NextResponse.redirect(new URL("/launch?unsubscribed=1", site))
}
