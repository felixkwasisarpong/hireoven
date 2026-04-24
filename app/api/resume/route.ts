import { NextResponse } from "next/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { createClient } from "@/lib/supabase/server"
import type { Resume } from "@/types"

export const runtime = "nodejs"

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const pool = getPostgresPool()
    const result = await pool.query<Resume>(
      `SELECT *
       FROM resumes
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [user.id]
    )
    return NextResponse.json(result.rows)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch resumes" },
      { status: 500 }
    )
  }
}
