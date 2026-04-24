import { NextRequest, NextResponse } from "next/server"
import { domainFromApplyUrl } from "@/lib/applications/company-domain"
import { getPostgresPool } from "@/lib/postgres/server"
import { createClient } from "@/lib/supabase/server"
import { randomUUID } from "crypto"

export const runtime = "nodejs"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const pool = getPostgresPool()

  const result = await pool.query<Record<string, unknown> & { company_domain: string | null }>(
    `SELECT
       ja.*,
       companies.domain AS company_domain
     FROM job_applications ja
     LEFT JOIN jobs ON jobs.id = ja.job_id
     LEFT JOIN companies ON companies.id = jobs.company_id
     WHERE ja.id = $1
       AND ja.user_id = $2
     LIMIT 1`,
    [id, user.id]
  )
  const data = result.rows[0]

  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const fromJob = typeof data.company_domain === "string" ? data.company_domain.trim() : null
  const fromApply = domainFromApplyUrl((data.apply_url as string | null) ?? null)
  return NextResponse.json({
    application: {
      ...data,
      company_domain: fromJob || fromApply || null,
    },
  })
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const pool = getPostgresPool()

  const body = await request.json().catch(() => ({})) as Record<string, unknown>

  // Fetch current application to build timeline entry
  const currentResult = await pool.query<{
    status: string
    timeline: unknown[] | null
    applied_at: string | null
  }>(
    `SELECT status, timeline, applied_at
     FROM job_applications
     WHERE id = $1
       AND user_id = $2
     LIMIT 1`,
    [id, user.id]
  )
  const current = currentResult.rows[0]

  if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const updates: Record<string, unknown> = { ...body, updated_at: new Date().toISOString() }

  // Auto-create timeline entry on status change
  if (body.status && body.status !== current.status) {
    const newEntry = {
      id: randomUUID(),
      type: "status_change",
      status: body.status,
      date: new Date().toISOString(),
      auto: true,
      note: null,
    }
    updates.timeline = [...((current.timeline as unknown[]) ?? []), newEntry]

    // Auto-set applied_at when moved to applied
    if (body.status === "applied" && !current.applied_at) {
      updates.applied_at = new Date().toISOString()
    }
  }

  const allowed = new Set([
    "job_id",
    "resume_id",
    "status",
    "company_name",
    "company_logo_url",
    "job_title",
    "apply_url",
    "applied_at",
    "match_score",
    "notes",
    "timeline",
    "interviews",
    "offer_details",
    "source",
  ])
  const entries = Object.entries(updates).filter(([key]) => allowed.has(key) || key === "updated_at")
  const values: unknown[] = []
  const setSql = entries.map(([key, value], idx) => {
    values.push(value)
    const cast = key === "timeline" || key === "interviews" || key === "offer_details" ? "::jsonb" : ""
    if (cast) {
      values[idx] = JSON.stringify(value)
    }
    return `${key} = $${idx + 1}${cast}`
  })
  values.push(id, user.id)

  const updateResult = await pool.query<{ id: string }>(
    `UPDATE job_applications
     SET ${setSql.join(", ")}
     WHERE id = $${values.length - 1}
       AND user_id = $${values.length}
     RETURNING id`,
    values
  )
  if (!updateResult.rows[0]) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const updatedResult = await pool.query<Record<string, unknown> & { company_domain: string | null }>(
    `SELECT
       ja.*,
       companies.domain AS company_domain
     FROM job_applications ja
     LEFT JOIN jobs ON jobs.id = ja.job_id
     LEFT JOIN companies ON companies.id = jobs.company_id
     WHERE ja.id = $1
       AND ja.user_id = $2
     LIMIT 1`,
    [id, user.id]
  )
  const data = updatedResult.rows[0]

  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const fromJob = typeof data.company_domain === "string" ? data.company_domain.trim() : null
  const fromApply = domainFromApplyUrl((data.apply_url as string | null) ?? null)
  return NextResponse.json({
    application: {
      ...data,
      company_domain: fromJob || fromApply || null,
    },
  })
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const pool = getPostgresPool()

  await pool.query(
    `UPDATE job_applications
     SET is_archived = true, updated_at = $1
     WHERE id = $2
       AND user_id = $3`,
    [new Date().toISOString(), id, user.id]
  )
  return NextResponse.json({ ok: true })
}
