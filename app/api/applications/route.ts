import { NextRequest, NextResponse } from "next/server"
import { domainFromApplyUrl } from "@/lib/applications/company-domain"
import { getPostgresPool } from "@/lib/postgres/server"
import { createClient } from "@/lib/supabase/server"
import { randomUUID } from "crypto"

export const runtime = "nodejs"

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const pool = getPostgresPool()

  const url = request.nextUrl
  const jobId = url.searchParams.get("jobId")
  const status = url.searchParams.get("status")
  const search = url.searchParams.get("search")
  const sort = url.searchParams.get("sort") ?? "updated_at"

  if (jobId) {
    const result = await pool.query<{ id: string; status: string; applied_at: string | null }>(
      `SELECT id, status, applied_at
       FROM job_applications
       WHERE user_id = $1
         AND job_id = $2
         AND is_archived = false
       ORDER BY applied_at DESC NULLS LAST
       LIMIT 1`,
      [user.id, jobId]
    )

    return NextResponse.json({
      hasApplied: result.rows.length > 0,
      application: result.rows[0] ?? null,
    })
  }

  const where: string[] = ["ja.user_id = $1", "ja.is_archived = false"]
  const values: Array<string> = [user.id]
  const addParam = (value: string) => {
    values.push(value)
    return `$${values.length}`
  }

  if (status) where.push(`ja.status = ${addParam(status)}`)
  if (search) {
    const searchPattern = `%${search}%`
    where.push(
      `(ja.company_name ILIKE ${addParam(searchPattern)} OR ja.job_title ILIKE ${addParam(searchPattern)})`
    )
  }

  const sortCol = ["applied_at", "created_at", "updated_at", "match_score", "company_name"].includes(sort)
    ? sort : "updated_at"
  const orderBy = sortCol === "company_name" ? "ASC" : "DESC"

  const result = await pool.query<Record<string, unknown> & { company_domain: string | null }>(
    `SELECT
       ja.*,
       companies.domain AS company_domain
     FROM job_applications ja
     LEFT JOIN jobs ON jobs.id = ja.job_id
     LEFT JOIN companies ON companies.id = jobs.company_id
     WHERE ${where.join(" AND ")}
     ORDER BY ja.${sortCol} ${orderBy}
     LIMIT 500`,
    values
  )

  const applications = result.rows.map((row) => {
    const fromJob = typeof row.company_domain === "string" ? row.company_domain.trim() : null
    const fromApply = domainFromApplyUrl((row.apply_url as string | null) ?? null)
    return {
      ...row,
      company_domain: fromJob || fromApply || null,
    }
  })

  return NextResponse.json({ applications })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const pool = getPostgresPool()

  const body = await request.json().catch(() => ({})) as {
    jobId?: string
    companyName?: string
    companyLogoUrl?: string
    jobTitle?: string
    applyUrl?: string
    status?: string
    resumeId?: string
    matchScore?: number
    notes?: string
    appliedAt?: string
    source?: string
  }

  if (!body.companyName?.trim() || !body.jobTitle?.trim()) {
    return NextResponse.json({ error: "companyName and jobTitle are required" }, { status: 400 })
  }

  const now = new Date().toISOString()
  const status = body.status ?? "saved"

  const initialEntry = {
    id: randomUUID(),
    type: "status_change",
    status,
    date: now,
    auto: true,
    note: status === "applied" ? "Application submitted" : `Added to ${status}`,
  }

  try {
    const inserted = await pool.query<Record<string, unknown>>(
      `INSERT INTO job_applications (
        user_id,
        job_id,
        resume_id,
        status,
        company_name,
        company_logo_url,
        job_title,
        apply_url,
        applied_at,
        match_score,
        notes,
        timeline,
        interviews,
        is_archived,
        source
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb, false, $14
      )
      RETURNING *`,
      [
        user.id,
        body.jobId ?? null,
        body.resumeId ?? null,
        status,
        body.companyName,
        body.companyLogoUrl ?? null,
        body.jobTitle,
        body.applyUrl ?? null,
        status === "applied" ? (body.appliedAt ?? now) : null,
        body.matchScore ?? null,
        body.notes ?? null,
        JSON.stringify([initialEntry]),
        JSON.stringify([]),
        body.source ?? "manual",
      ]
    )

    const application = inserted.rows[0] as Record<string, unknown>
    const fromApply = domainFromApplyUrl((application.apply_url as string | null) ?? null)
    return NextResponse.json(
      {
        application: {
          ...application,
          company_domain: fromApply ?? null,
        },
      },
      { status: 201 }
    )
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create application" },
      { status: 500 }
    )
  }
}
