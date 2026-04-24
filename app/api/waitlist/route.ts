import { randomBytes } from "crypto"
import { NextResponse } from "next/server"
import { z } from "zod"
import { getPostgresPool } from "@/lib/postgres/server"
import { upsertMarketingSubscriber } from "@/lib/marketing/subscribers"
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

  const pool = getPostgresPool()
  const existingResult = await pool.query<{
    id: string
    email: string
    joined_at: string
    confirmation_token: string | null
    is_international: boolean | null
  }>(
    `SELECT id, email, joined_at, confirmation_token, is_international
     FROM waitlist
     WHERE email = $1
     LIMIT 1`,
    [email]
  )
  const existing = existingResult.rows[0]

  if (existing) {
    const positionResult = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM waitlist
       WHERE joined_at <= $1`,
      [existing.joined_at]
    )
    const position = Number(positionResult.rows[0]?.count ?? 1)
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

  let inserted: { id: string; joined_at: string } | null = null
  try {
    const insertResult = await pool.query<{ id: string; joined_at: string }>(
      `INSERT INTO waitlist (
        email,
        source,
        referrer,
        is_international,
        visa_status,
        university,
        metadata,
        confirmation_token,
        confirmed
      ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, false)
      RETURNING id, joined_at`,
      [
        email,
        source,
        referrer,
        parsed.data.isInternational ?? null,
        parsed.data.visaStatus?.trim() || null,
        parsed.data.university?.trim() || null,
        JSON.stringify(Object.keys(meta).length ? meta : null),
        confirmationToken,
      ]
    )
    inserted = insertResult.rows[0] ?? null
  } catch (insertError) {
    console.error("[waitlist] insert", insertError)
    return NextResponse.json({ error: "Could not join waitlist" }, { status: 500 })
  }
  if (!inserted) return NextResponse.json({ error: "Could not join waitlist" }, { status: 500 })

  const positionResult = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM waitlist
     WHERE joined_at <= $1`,
    [inserted.joined_at]
  )
  const position = Number(positionResult.rows[0]?.count ?? 1)

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
