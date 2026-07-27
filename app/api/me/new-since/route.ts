import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"
import { sqlPublishedJob } from "@/lib/jobs/publication"
import { sqlJobLocatedInUsa } from "@/lib/jobs/usa-job-sql"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const CAP = 500

// How many fresh, relevant roles appeared since the user's last dashboard visit.
// Powers the "N new since you left" habit banner. Scoped to the user's alert
// keywords (or profile desired_roles) when available so the number is relevant,
// not a raw feed count.
export async function GET(request: NextRequest) {
  if (!hasPostgresEnv()) return NextResponse.json({ count: 0 })

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ count: 0 })

  const sinceParam = request.nextUrl.searchParams.get("since")
  const since = sinceParam ? new Date(sinceParam) : null
  if (!since || Number.isNaN(since.getTime())) return NextResponse.json({ count: 0 })

  // Bound the window so a long-absent user's query stays a fast, indexed walk.
  const floor = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const from = since < floor ? floor : since

  const pool = getPostgresPool()

  // Personalize by the user's first active alert's keywords, falling back to
  // their stated roles.
  let keywords: string[] = []
  try {
    const kw = await pool.query<{ keywords: string[] | null }>(
      `SELECT keywords FROM job_alerts
        WHERE user_id = $1 AND is_active = true AND array_length(keywords, 1) > 0
        ORDER BY created_at ASC LIMIT 1`,
      [user.id],
    )
    keywords = kw.rows[0]?.keywords ?? []
    if (keywords.length === 0) {
      const pr = await pool.query<{ desired_roles: string[] | null }>(
        `SELECT desired_roles FROM profiles WHERE id = $1`,
        [user.id],
      )
      keywords = pr.rows[0]?.desired_roles ?? []
    }
  } catch {
    keywords = []
  }

  const where: string[] = [
    "jobs.is_active = true",
    sqlPublishedJob("jobs"),
    sqlJobLocatedInUsa("jobs"),
    "jobs.first_detected_at > $1::timestamptz",
  ]
  const values: Array<string | string[]> = [from.toISOString()]
  let personalized = false
  if (keywords.length > 0) {
    values.push(keywords.map((k) => `%${k}%`))
    where.push(`(jobs.normalized_title ILIKE ANY($2::text[]) OR jobs.title ILIKE ANY($2::text[]))`)
    personalized = true
  }

  try {
    const { rows } = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM (SELECT 1 FROM jobs WHERE ${where.join(" AND ")} LIMIT ${CAP}) t`,
      values,
    )
    const count = Number(rows[0]?.count ?? 0)
    return NextResponse.json(
      { count, personalized, capped: count >= CAP },
      { headers: { "Cache-Control": "no-store" } },
    )
  } catch {
    return NextResponse.json({ count: 0 })
  }
}
