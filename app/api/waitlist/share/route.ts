import { NextResponse } from "next/server"
import { z } from "zod"
import { getPostgresPool } from "@/lib/postgres/server"

const schema = z.object({
  email: z.string().email(),
  channel: z.enum(["twitter", "linkedin", "copy"]),
})

function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

/** Merge share click counts into waitlist.metadata for funnel analytics. */
export async function POST(request: Request) {
  let json: unknown
  try {
    json = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const parsed = schema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  }

  const pool = getPostgresPool()

  const email = normalizeEmail(parsed.data.email)
  const rowResult = await pool.query<{ id: string; metadata: Record<string, unknown> | null }>(
    `SELECT id, metadata
     FROM waitlist
     WHERE email = $1
     LIMIT 1`,
    [email]
  )
  const row = rowResult.rows[0]

  if (!row) {
    return NextResponse.json({ ok: true })
  }

  const prev =
    row.metadata && typeof row.metadata === "object" ? row.metadata : {}
  const shares =
    prev && typeof prev.share_clicks === "object" && prev.share_clicks !== null
      ? { ...(prev.share_clicks as Record<string, number>) }
      : {}

  const key = parsed.data.channel
  shares[key] = (shares[key] ?? 0) + 1

  await pool.query(
    `UPDATE waitlist
     SET metadata = $1::jsonb
     WHERE id = $2`,
    [JSON.stringify({ ...prev, share_clicks: shares }), row.id]
  )

  return NextResponse.json({ ok: true })
}
