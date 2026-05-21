import { NextResponse } from "next/server"
import { z } from "zod"
import { getPostgresPool } from "@/lib/postgres/server"

const bodySchema = z.object({
  message: z.string().min(3).max(4000),
  email: z.string().max(320).optional().nullable(),
  rating: z.number().int().min(1).max(5).optional().nullable(),
  path: z.string().max(500).optional().nullable(),
  metadata: z.record(z.string(), z.any()).optional(),
})

function normalizeEmail(email: string | null | undefined) {
  if (!email) return null
  const trimmed = email.trim().toLowerCase()
  if (!trimmed) return null
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return null
  return trimmed
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

  const message = parsed.data.message.trim()
  if (!message) {
    return NextResponse.json({ error: "Message required" }, { status: 400 })
  }

  const email = normalizeEmail(parsed.data.email)
  const userAgent = request.headers.get("user-agent")?.slice(0, 500) ?? null
  const meta = parsed.data.metadata && typeof parsed.data.metadata === "object"
    ? parsed.data.metadata
    : null

  const pool = getPostgresPool()
  try {
    await pool.query(
      `INSERT INTO waitlist_feedback (email, rating, message, path, user_agent, metadata)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        email,
        parsed.data.rating ?? null,
        message,
        parsed.data.path?.slice(0, 500) ?? null,
        userAgent,
        meta ? JSON.stringify(meta) : null,
      ]
    )
  } catch (error) {
    console.error("[waitlist/feedback] insert", error)
    return NextResponse.json({ error: "Could not save feedback" }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
