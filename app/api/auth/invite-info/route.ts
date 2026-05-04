import { NextRequest, NextResponse } from "next/server"
import { getPostgresPool } from "@/lib/postgres/server"

export const runtime = "nodejs"

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token")?.trim()
  if (!token) return NextResponse.json({ error: "token required" }, { status: 400 })

  const pool = getPostgresPool()
  const row = await pool.query<{ email: string }>(
    `SELECT email FROM waitlist
     WHERE invite_token = $1 AND approved = true AND invite_used_at IS NULL
     LIMIT 1`,
    [token]
  ).then((r) => r.rows[0]).catch(() => null)

  if (!row) return NextResponse.json({ error: "invalid" }, { status: 404 })

  return NextResponse.json({ email: row.email })
}
