import { NextRequest, NextResponse } from "next/server"
import { getSessionUser } from "@/lib/auth/session-user"
import { getPostgresPool } from "@/lib/postgres/server"
import type { ResumeSnapshot, ResumeVersion } from "@/types"

export const runtime = "nodejs"

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const resumeId = params.id
  const pool = getPostgresPool()
  const own = await pool.query(`SELECT 1 FROM resumes WHERE id = $1 AND user_id = $2 LIMIT 1`, [
    resumeId,
    user.sub,
  ])
  if (!own.rowCount) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const result = await pool.query<ResumeVersion>(
    `SELECT rv.*
     FROM resume_versions rv
     INNER JOIN resumes r ON r.id = rv.resume_id
     WHERE rv.resume_id = $1 AND r.user_id = $2
     ORDER BY rv.created_at DESC`,
    [resumeId, user.sub]
  )
  return NextResponse.json({ versions: result.rows })
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const resumeId = params.id
  const body = (await request.json().catch(() => ({}))) as {
    version_number?: number
    name?: string | null
    file_url?: string | null
    snapshot?: ResumeSnapshot | null
    changes_summary?: string | null
  }

  const pool = getPostgresPool()
  const resume = await pool.query<{ id: string; user_id: string }>(
    `SELECT id, user_id FROM resumes WHERE id = $1 AND user_id = $2 LIMIT 1`,
    [resumeId, user.sub]
  )
  if (!resume.rows[0]) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const maxRes = await pool.query<{ m: string | null }>(
    `SELECT MAX(version_number)::text AS m FROM resume_versions WHERE resume_id = $1`,
    [resumeId]
  )
  const nextNum =
    body.version_number ??
    (maxRes.rows[0]?.m ? Number.parseInt(maxRes.rows[0].m, 10) + 1 : 1)

  const insert = await pool.query<ResumeVersion>(
    `INSERT INTO resume_versions (resume_id, user_id, version_number, name, file_url, snapshot, changes_summary)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
     RETURNING *`,
    [
      resumeId,
      user.sub,
      nextNum,
      body.name ?? `Version ${nextNum}`,
      body.file_url ?? null,
      body.snapshot ? JSON.stringify(body.snapshot) : null,
      body.changes_summary ?? null,
    ]
  )

  return NextResponse.json({ version: insert.rows[0] })
}
