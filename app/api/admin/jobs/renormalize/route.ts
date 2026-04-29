import { NextRequest, NextResponse } from "next/server"
import { assertAdminAccess } from "@/lib/admin/auth"
import { enrichJobWithNormalization } from "@/lib/jobs/enrich-job-with-normalization"
import { getPostgresPool } from "@/lib/postgres/server"
import type { Job } from "@/types"

export async function POST(request: NextRequest) {
  const access = await assertAdminAccess()
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const body = (await request.json()) as { ids: string[] }
  const ids = body.ids ?? []

  if (!ids.length) {
    return NextResponse.json({ error: "Missing job ids" }, { status: 400 })
  }

  const pool = getPostgresPool()
  let jobs: Job[]
  try {
    const result = await pool.query<Job>(`SELECT * FROM jobs WHERE id = ANY($1::uuid[])`, [ids])
    jobs = result.rows
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Database query failed" },
      { status: 500 }
    )
  }
  const updated: string[] = []
  const refreshedDescriptions: string[] = []

  for (const job of jobs) {
    const result = await enrichJobWithNormalization(pool, job.id)
    if (result.ok && result.updatedColumns) {
      updated.push(job.id)
    }
    if (result.ok && result.refreshedDescription) {
      refreshedDescriptions.push(job.id)
    }
  }

  return NextResponse.json({
    success: true,
    updated,
    refreshedDescriptions,
  })
}
