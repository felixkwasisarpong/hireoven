import { NextResponse } from "next/server"
import { upsertMarketingSubscriber } from "@/lib/marketing/subscribers"
import { getPostgresPool } from "@/lib/postgres/server"
import { getPublicSiteUrl } from "@/lib/waitlist/site-url"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const token = searchParams.get("token")?.trim()
  if (!token) {
    return NextResponse.redirect(new URL("/launch", getPublicSiteUrl()))
  }

  const pool = getPostgresPool()
  const rowResult = await pool.query<{ id: string; email: string | null }>(
    `SELECT id, email
     FROM waitlist
     WHERE confirmation_token = $1
     LIMIT 1`,
    [token]
  )
  const row = rowResult.rows[0]

  if (!row) {
    return NextResponse.redirect(
      new URL("/launch?error=invalid-token", getPublicSiteUrl())
    )
  }

  await pool.query("UPDATE waitlist SET confirmed = true WHERE id = $1", [row.id])

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
