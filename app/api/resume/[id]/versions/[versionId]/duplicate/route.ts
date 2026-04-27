import { NextResponse } from "next/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { createResumeSnapshot, isUuid, restoreResumeFromSnapshot } from "@/lib/resume/hub"
import { createClient } from "@/lib/supabase/server"
import type { Resume, ResumeVersion } from "@/types"

export const runtime = "nodejs"

export async function POST(
  _request: Request,
  { params }: { params: { id: string; versionId: string } }
) {
  const { id, versionId } = params
  if (!isUuid(id) || !isUuid(versionId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 })
  }

  const supabase = await createClient()
  const user = (await supabase.auth.getUser()).data.user
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const pool = getPostgresPool()
  const [resumeResult, versionResult, maxResult] = await Promise.all([
    pool.query<Resume>(
      `SELECT * FROM resumes WHERE id = $1 AND user_id = $2 LIMIT 1`,
      [id, user.id]
    ),
    pool.query<ResumeVersion>(
      `SELECT * FROM resume_versions
       WHERE id = $1 AND resume_id = $2 AND user_id = $3
       LIMIT 1`,
      [versionId, id, user.id]
    ),
    pool.query<{ m: string | null }>(
      `SELECT MAX(version_number)::text AS m FROM resume_versions WHERE resume_id = $1 AND user_id = $2`,
      [id, user.id]
    ),
  ])
  const resume = resumeResult.rows[0]
  const version = versionResult.rows[0]
  if (!resume) return NextResponse.json({ error: "Resume not found" }, { status: 404 })
  if (!version) return NextResponse.json({ error: "Version not found" }, { status: 404 })

  const snapshot = version.snapshot
    ? createResumeSnapshot(restoreResumeFromSnapshot(resume, version.snapshot))
    : createResumeSnapshot(resume)
  const nextNum = maxResult.rows[0]?.m ? Number.parseInt(maxResult.rows[0].m, 10) + 1 : 1
  const duplicate = await pool.query<ResumeVersion>(
    `INSERT INTO resume_versions (
      resume_id,
      user_id,
      version_number,
      name,
      file_url,
      snapshot,
      changes_summary
    ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
    RETURNING *`,
    [
      id,
      user.id,
      nextNum,
      `${version.name ?? `Version ${version.version_number}`} copy`,
      version.file_url,
      JSON.stringify(snapshot),
      "Duplicated from version history.",
    ]
  )

  return NextResponse.json({ version: duplicate.rows[0] })
}
