import { NextResponse } from "next/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { createClient } from "@/lib/supabase/server"

export const runtime = "nodejs"

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const pool = getPostgresPool()
  const result = await pool.query<Record<string, unknown>>(
    `SELECT *
     FROM autofill_history
     WHERE user_id = $1
     ORDER BY applied_at DESC
     LIMIT 100`,
    [user.id]
  )
  const history = result.rows
  const totalApplications = history.length
  const avgFillRate =
    totalApplications > 0
      ? Math.round(
          history.reduce((acc: number, h: any) => acc + (h.fill_rate ?? 0), 0) /
            totalApplications
        )
      : 0

  // Rough time saved: ~12 min per application on average
  const minutesSaved = totalApplications * 12

  return NextResponse.json({ history, totalApplications, avgFillRate, minutesSaved })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json().catch(() => ({})) as {
    job_id?: string
    resume_id?: string
    company_name?: string
    job_title?: string
    apply_url?: string
    ats_type?: string
    fields_filled?: number
    fields_total?: number
  }

  const { fields_filled = 0, fields_total = 1 } = body
  const fill_rate = fields_total > 0 ? Math.round((fields_filled / fields_total) * 100) : 0

  const now = new Date().toISOString()
  const pool = getPostgresPool()

  if (body.job_id) {
    const timeline = [{ status: "applied", date: now, note: "Logged via Hireoven autofill" }]

    const existingResult = await pool.query<{ id: string }>(
      `SELECT id
       FROM job_applications
       WHERE user_id = $1
         AND job_id = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [user.id, body.job_id]
    )
    const existingApplication = existingResult.rows[0]

    if (existingApplication?.id) {
      await pool.query(
        `UPDATE job_applications
         SET resume_id = $1,
             status = 'applied',
             company_name = $2,
             job_title = $3,
             apply_url = $4,
             applied_at = $5,
             timeline = $6::jsonb,
             updated_at = now()
         WHERE id = $7`,
        [
          body.resume_id ?? null,
          body.company_name ?? "Unknown company",
          body.job_title ?? "Untitled role",
          body.apply_url ?? null,
          now,
          JSON.stringify(timeline),
          existingApplication.id,
        ]
      )
    } else {
      await pool.query(
        `INSERT INTO job_applications (
          user_id, job_id, resume_id, status, company_name, job_title, apply_url, applied_at, timeline
        ) VALUES ($1, $2, $3, 'applied', $4, $5, $6, $7, $8::jsonb)`,
        [
          user.id,
          body.job_id,
          body.resume_id ?? null,
          body.company_name ?? "Unknown company",
          body.job_title ?? "Untitled role",
          body.apply_url ?? null,
          now,
          JSON.stringify(timeline),
        ]
      )
    }
  }

  const insertResult = await pool.query<Record<string, unknown>>(
    `INSERT INTO autofill_history (
      user_id, job_id, company_name, job_title, ats_type, fields_filled, fields_total, fill_rate
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *`,
    [
      user.id,
      body.job_id ?? null,
      body.company_name ?? null,
      body.job_title ?? null,
      body.ats_type ?? null,
      fields_filled,
      fields_total,
      fill_rate,
    ]
  )
  return NextResponse.json({ entry: insertResult.rows[0] ?? null }, { status: 201 })
}
