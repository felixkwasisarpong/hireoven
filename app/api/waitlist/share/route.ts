import { NextResponse } from "next/server"
import { z } from "zod"
import { createAdminClient } from "@/lib/supabase/admin"

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

  let supabase
  try {
    supabase = createAdminClient()
  } catch {
    return NextResponse.json({ ok: true })
  }

  const email = normalizeEmail(parsed.data.email)
  const { data: row } = await supabase
    .from("waitlist")
    .select("id, metadata")
    .eq("email", email)
    .maybeSingle()

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

  await supabase
    .from("waitlist")
    .update({
      metadata: { ...prev, share_clicks: shares },
    })
    .eq("id", row.id)

  return NextResponse.json({ ok: true })
}
