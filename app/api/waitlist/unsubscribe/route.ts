import { NextResponse } from "next/server"
import { upsertMarketingSubscriber } from "@/lib/marketing/subscribers"
import { getPostgresPool } from "@/lib/postgres/server"
import { getPublicSiteUrl } from "@/lib/waitlist/site-url"

/** One-click unsubscribe from waitlist marketing (metadata flag). */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const token = searchParams.get("token")?.trim()
  const site = getPublicSiteUrl()
  if (!token) {
    return NextResponse.redirect(new URL("/launch", site))
  }

  const pool = getPostgresPool()
  const rowResult = await pool.query<{
    id: string
    email: string | null
    metadata: Record<string, unknown> | null
  }>(
    `SELECT id, email, metadata
     FROM waitlist
     WHERE confirmation_token = $1
     LIMIT 1`,
    [token]
  )
  const row = rowResult.rows[0]

  if (!row) {
    return NextResponse.redirect(new URL("/launch", site))
  }

  const meta = {
    ...(row.metadata && typeof row.metadata === "object" ? row.metadata : {}),
    marketing_unsubscribed: true,
    marketing_unsubscribed_at: new Date().toISOString(),
  }

  await pool.query("UPDATE waitlist SET metadata = $1::jsonb WHERE id = $2", [JSON.stringify(meta), row.id])
  if (row.email) {
    await upsertMarketingSubscriber({
      email: row.email,
      source: "waitlist_unsubscribe",
      metadata: { unsubscribed_from_waitlist: true },
    })
    await pool.query(
      `UPDATE marketing_subscribers
       SET subscribed_to_marketing = false,
           unsubscribed_at = $1,
           updated_at = now()
       WHERE email = $2`,
      [new Date().toISOString(), row.email.toLowerCase()]
    )
  }

  return NextResponse.redirect(new URL("/launch?unsubscribed=1", site))
}
