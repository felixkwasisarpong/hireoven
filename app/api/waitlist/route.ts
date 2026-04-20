import { randomBytes } from "crypto"
import { NextResponse } from "next/server"
import { z } from "zod"
import { createAdminClient } from "@/lib/supabase/admin"
import { upsertMarketingSubscriber } from "@/lib/marketing/subscribers"
import { getWaitlistPosition } from "@/lib/waitlist/position"
import { sendWaitlistConfirmationEmail } from "@/lib/waitlist/send-confirmation"

const bodySchema = z.object({
  email: z.string().min(3).max(320),
  isInternational: z.boolean().optional(),
  visaStatus: z.string().max(120).optional().nullable(),
  university: z.string().max(200).optional().nullable(),
  source: z.string().max(64).optional(),
  referrer: z.string().max(2000).optional().nullable(),
  metadata: z.record(z.string(), z.any()).optional(),
})

function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

export async function POST(request: Request) {
  let json: unknown
  try {
    json = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const email = normalizeEmail(parsed.data.email)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 })
  }

  let supabase
  try {
    supabase = createAdminClient()
  } catch (e) {
    console.error("[waitlist]", e)
    return NextResponse.json(
      { error: "Server configuration error" },
      { status: 500 }
    )
  }

  const { data: existing } = await supabase
    .from("waitlist")
    .select("id, email, joined_at, confirmation_token, is_international")
    .eq("email", email)
    .maybeSingle()

  if (existing) {
    const position = await getWaitlistPosition(supabase, existing.joined_at)
    return NextResponse.json({
      success: true,
      position,
      message: `You're #${position} on the waitlist`,
      id: existing.id,
    })
  }

  const confirmationToken = randomBytes(32).toString("hex")
  const source = parsed.data.source?.trim() || "launch_page"
  const referrer = parsed.data.referrer?.trim() ?? null
  const meta = {
    ...(parsed.data.metadata && typeof parsed.data.metadata === "object"
      ? parsed.data.metadata
      : {}),
  }

  const { data: inserted, error: insertError } = await supabase
    .from("waitlist")
    .insert({
      email,
      source,
      referrer,
      is_international: parsed.data.isInternational ?? null,
      visa_status: parsed.data.visaStatus?.trim() || null,
      university: parsed.data.university?.trim() || null,
      metadata: Object.keys(meta).length ? meta : null,
      confirmation_token: confirmationToken,
      confirmed: false,
    })
    .select("id, joined_at")
    .single()

  if (insertError || !inserted) {
    console.error("[waitlist] insert", insertError)
    return NextResponse.json({ error: "Could not join waitlist" }, { status: 500 })
  }

  const position = await getWaitlistPosition(supabase, inserted.joined_at)

  await upsertMarketingSubscriber({
    email,
    source: "waitlist",
    metadata: { waitlist: true },
  })

  await sendWaitlistConfirmationEmail({
    email,
    token: confirmationToken,
    isInternational: parsed.data.isInternational,
  })

  return NextResponse.json({
    success: true,
    position,
    message: `You're #${position} on the waitlist`,
    id: inserted.id,
  })
}
