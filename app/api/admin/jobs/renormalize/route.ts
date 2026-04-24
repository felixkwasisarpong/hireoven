import { NextRequest, NextResponse } from "next/server"
import { assertAdminAccess } from "@/lib/admin/auth"
import { fetchJobDescription } from "@/lib/jobs/description"
import {
  normalizePersistedJobRecord,
  type PersistedJobForNormalization,
} from "@/lib/jobs/normalization"
import { getPostgresPool } from "@/lib/postgres/server"
import type { Job } from "@/types"

const JOB_RENORMALIZE_COLUMNS = new Set([
  "normalized_title",
  "description",
  "location",
  "employment_type",
  "seniority_level",
  "is_remote",
  "is_hybrid",
  "salary_min",
  "salary_max",
  "salary_currency",
  "sponsors_h1b",
  "sponsorship_score",
  "requires_authorization",
  "visa_language_detected",
  "skills",
  "raw_data",
  "updated_at",
])

async function updateJobRenormalized(
  pool: ReturnType<typeof getPostgresPool>,
  jobId: string,
  payload: Record<string, unknown>
): Promise<boolean> {
  const entries = Object.entries(payload).filter(([k]) => JOB_RENORMALIZE_COLUMNS.has(k))
  if (entries.length === 0) return false
  const values = entries.map(([, v]) => v)
  const setClause = entries.map(([k], i) => `${k} = $${i + 1}`).join(", ")
  const result = await pool.query(
    `UPDATE jobs SET ${setClause} WHERE id = $${values.length + 1}::uuid`,
    [...values, jobId]
  )
  return (result.rowCount ?? 0) > 0
}

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
    let jobForNormalization = job

    if (!job.description?.trim() && job.apply_url) {
      const fetchedDescription = await fetchJobDescription(job.apply_url)
      if (fetchedDescription) {
        jobForNormalization = {
          ...job,
          description: fetchedDescription,
        }
        refreshedDescriptions.push(job.id)
      }
    }

    const normalization = normalizePersistedJobRecord(
      jobForNormalization as PersistedJobForNormalization
    )

    const existingRawData =
      jobForNormalization.raw_data && typeof jobForNormalization.raw_data === "object"
        ? (jobForNormalization.raw_data as Record<string, unknown>)
        : {}

    const nextPayload: Record<string, unknown> = {
      ...normalization.nextColumns,
      raw_data: {
        ...existingRawData,
        normalization: {
          version: normalization.canonical.schema_version,
          normalized_at: normalization.canonical.normalized_at,
          confidence_score: normalization.canonical.validation.confidence_score,
          completeness_score: normalization.canonical.validation.completeness_score,
          requires_review: normalization.canonical.validation.requires_review,
          issues: normalization.canonical.validation.issues,
        },
        normalized: normalization.canonical,
        view: {
          page: normalization.pageView,
          card: normalization.cardView,
        },
      },
      updated_at: new Date().toISOString(),
    }

    const ok = await updateJobRenormalized(pool, job.id, nextPayload)
    if (ok) {
      updated.push(job.id)
    }
  }

  return NextResponse.json({
    success: true,
    updated,
    refreshedDescriptions,
  })
}
