import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { getInterviewSession } from "@/lib/scout/interview/queries"
import { randomBytes } from "crypto"

export const runtime = "nodejs"

function generateToken(): string {
  return randomBytes(18).toString("base64url")
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const session = await getInterviewSession(id, user.id)
  if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (session.status !== "completed") {
    return NextResponse.json({ error: "Session must be completed to share" }, { status: 400 })
  }

  const body = await request.json().catch(() => ({})) as {
    redactQuotes?: boolean
    redactVoice?: boolean
    ttlDays?: number
  }

  const ttlDays = [7, 14, 30].includes(body.ttlDays ?? 0) ? body.ttlDays! : 14
  const token = generateToken()
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000)

  const pool = getPostgresPool()
  const result = await pool.query<{ id: string; expires_at: string }>(
    `INSERT INTO interview_shared_links
       (session_id, user_id, token, redact_quotes, redact_voice, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, expires_at`,
    [
      id,
      user.id,
      token,
      body.redactQuotes ?? true,
      body.redactVoice ?? false,
      expiresAt.toISOString(),
    ]
  )

  const row = result.rows[0]
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"

  return NextResponse.json({
    shareId: row.id,
    url: `${siteUrl}/shared/interview/${token}`,
    expiresAt: row.expires_at,
  }, { status: 201 })
}
