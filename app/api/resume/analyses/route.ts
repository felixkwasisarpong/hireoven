import { NextRequest, NextResponse } from "next/server"
import { getSessionUser } from "@/lib/auth/session-user"
import { getPostgresPool } from "@/lib/postgres/server"

export const runtime = "nodejs"

export async function GET(request: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const ids =
    request.nextUrl.searchParams
      .get("resume_ids")
      ?.split(",")
      .map((s) => s.trim())
      .filter(Boolean) ?? []

  if (ids.length === 0) {
    return NextResponse.json({ analyses: [] })
  }

  const pool = getPostgresPool()
  const result = await pool.query<{
    resume_id: string
    job_id: string | null
    recommendations: unknown[] | null
    created_at: string
    job_title: string | null
  }>(
    `SELECT ra.resume_id, ra.job_id, ra.recommendations, ra.created_at, j.title AS job_title
     FROM resume_analyses ra
     LEFT JOIN jobs j ON j.id = ra.job_id
     WHERE ra.user_id = $1
       AND ra.resume_id = ANY($2::uuid[])
     ORDER BY ra.created_at DESC`,
    [user.sub, ids]
  )

  return NextResponse.json({ analyses: result.rows })
}
