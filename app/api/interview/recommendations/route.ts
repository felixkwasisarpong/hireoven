import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres/server"

export const runtime = "nodejs"

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const pool = getPostgresPool()

  try {
    const result = await pool.query<{
      id: string
      title: string
      company: string
      saved_at: string
    }>(
      `SELECT * FROM (
         SELECT DISTINCT ON (ja.job_id)
           ja.job_id  AS id,
           ja.job_title AS title,
           ja.company_name AS company,
           ja.created_at AS saved_at
         FROM job_applications ja
         WHERE ja.user_id = $1
           AND ja.status NOT IN ('rejected', 'withdrawn')
           AND ja.is_archived = false
           AND ja.job_id IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM interview_sessions s
             WHERE s.user_id = $1
               AND s.job_id = ja.job_id
               AND s.status = 'completed'
           )
         ORDER BY ja.job_id, ja.created_at DESC
       ) sub
       ORDER BY saved_at DESC
       LIMIT 3`,
      [user.id]
    )

    return NextResponse.json({
      jobs: result.rows.map((r) => ({
        id: r.id,
        title: r.title,
        company: r.company,
        savedAt: r.saved_at,
      })),
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch recommendations" },
      { status: 500 }
    )
  }
}
